import { CATEGORIES, PRIORITIES, type Category, type Priority } from "../constants.js";
import { fetchWithTimeout, isRetryableHttpStatus, ProviderUnavailableError } from "../lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
const GROQ_TIMEOUT_MS = 25_000;

export type ClassificationResult = {
  category: Category;
  priority: Priority;
  summary: string;
  raw: unknown;
};

export type ClassificationOutcome =
  | { ok: true; result: ClassificationResult }
  | { ok: false; reason: "unavailable" | "parse_fallback"; raw: unknown };

const SYSTEM_PROMPT = `You are a service-desk triage assistant. Classify IT support incidents.
Return STRICT JSON with keys: category, priority, summary.

category must be exactly one of: ${CATEGORIES.join(", ")}
priority must be exactly one of: ${PRIORITIES.join(", ")}

Priority guide:
- Critical: outage, security breach, or many users blocked
- High: a user cannot work and no workaround exists
- Medium: degraded service or workaround available
- Low: cosmetic, how-to, or non-urgent request

summary: 1-2 sentences restating the issue in plain language.
Do not invent facts that are not in the ticket.`;

function apiKey(): string {
  return (process.env.GROQ_API_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const brace = trimmed.match(/\{[\s\S]*\}/);
    if (brace) return JSON.parse(brace[0]);
    throw new Error("not json");
  }
}

function normalizeCategory(value: unknown): Category | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  const aliases: Record<string, Category> = {
    network: "Network",
    hardware: "Hardware",
    software: "Software/App",
    "software/app": "Software/App",
    "software app": "Software/App",
    app: "Software/App",
    application: "Software/App",
    account: "Account/Access",
    access: "Account/Access",
    "account/access": "Account/Access",
    "account access": "Account/Access",
    other: "Other",
  };
  return CATEGORIES.find((c) => c.toLowerCase() === v) ?? aliases[v];
}

function normalizePriority(value: unknown): Priority | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  return PRIORITIES.find((p) => p.toLowerCase() === v);
}

function parseClassification(raw: unknown): ClassificationResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const category = normalizeCategory(obj.category ?? obj.Category);
  const priority = normalizePriority(obj.priority ?? obj.severity ?? obj.Priority);
  const summaryRaw = obj.summary ?? obj.Summary ?? obj.issue_summary;
  const summary = typeof summaryRaw === "string" ? summaryRaw.trim() : "";
  if (!category || !priority || !summary) return null;
  return { category, priority, summary, raw };
}

export async function classifyIncident(
  title: string,
  description: string,
): Promise<ClassificationOutcome> {
  const key = apiKey();
  if (!key) {
    return { ok: false, reason: "unavailable", raw: { error: "GROQ_API_KEY missing" } };
  }

  try {
    const response = await fetchWithTimeout(
      GROQ_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Classify this incident.\nTitle: ${title}\nDescription: ${description}`,
            },
          ],
        }),
      },
      GROQ_TIMEOUT_MS,
    );

    const bodyText = await response.text();
    if (isRetryableHttpStatus(response.status) || !response.ok) {
      console.warn("🤖 Groq HTTP", response.status, bodyText.slice(0, 300));
      return {
        ok: false,
        reason: "unavailable",
        raw: { error: "groq_http_error", status: response.status, body: bodyText.slice(0, 500) },
      };
    }

    const payload = JSON.parse(bodyText) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    let parsedJson: unknown;
    try {
      parsedJson = extractJson(content);
    } catch {
      console.warn("🤖 Groq JSON parse failed:", content.slice(0, 300));
      return {
        ok: false,
        reason: "parse_fallback",
        raw: { error: "malformed_json", content },
      };
    }

    const parsed = parseClassification(parsedJson);
    if (!parsed) {
      console.warn("🤖 Groq fields not recognized:", parsedJson);
      return { ok: false, reason: "parse_fallback", raw: parsedJson };
    }
    console.log(`🤖 Groq classified: ${parsed.category} / ${parsed.priority}`);
    return { ok: true, result: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown groq error";
    const status = err instanceof ProviderUnavailableError ? err.status : undefined;
    console.warn("🤖 Groq call failed:", message);
    return {
      ok: false,
      reason: "unavailable",
      raw: { error: "groq_unavailable", message, status },
    };
  }
}

export async function summarize(text: string): Promise<ClassificationOutcome> {
  return classifyIncident("Summary request", text);
}
