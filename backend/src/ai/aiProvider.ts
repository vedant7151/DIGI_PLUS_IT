import { CATEGORIES, PRIORITIES, type Category, type Priority } from "../constants.js";
import { fetchWithTimeout, isRetryableHttpStatus, ProviderUnavailableError } from "../lib/http.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_TIMEOUT_MS = 12_000;

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

function parseClassification(raw: unknown): ClassificationResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const category = CATEGORIES.find((c) => c === obj.category);
  const priority = PRIORITIES.find((p) => p === obj.priority);
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!category || !priority || !summary) return null;
  return { category, priority, summary, raw };
}

export async function classifyIncident(
  title: string,
  description: string,
): Promise<ClassificationOutcome> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "unavailable", raw: { error: "GROQ_API_KEY missing" } };
  }

  try {
    const response = await fetchWithTimeout(
      GROQ_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({ title, description }),
            },
          ],
        }),
      },
      GROQ_TIMEOUT_MS,
    );

    if (isRetryableHttpStatus(response.status) || !response.ok) {
      const body = await response.text().catch(() => "");
      if (isRetryableHttpStatus(response.status) || response.status === 408) {
        return {
          ok: false,
          reason: "unavailable",
          raw: { error: "groq_unavailable", status: response.status, body: body.slice(0, 500) },
        };
      }
      return {
        ok: false,
        reason: "unavailable",
        raw: { error: "groq_http_error", status: response.status, body: body.slice(0, 500) },
      };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      return {
        ok: false,
        reason: "parse_fallback",
        raw: { error: "malformed_json", content },
      };
    }

    const parsed = parseClassification(parsedJson);
    if (!parsed) {
      return { ok: false, reason: "parse_fallback", raw: parsedJson };
    }
    return { ok: true, result: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown groq error";
    const status = err instanceof ProviderUnavailableError ? err.status : undefined;
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
