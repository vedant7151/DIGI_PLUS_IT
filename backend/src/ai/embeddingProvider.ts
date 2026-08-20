import { fetchWithTimeout, isRetryableHttpStatus, ProviderUnavailableError } from "../lib/http.js";

const HF_EMBED_URL =
  "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction";
const HF_TIMEOUT_MS = 30_000;
let loggedLiveCall = false;

export type EmbeddingOutcome =
  | { ok: true; embedding: number[] }
  | { ok: false; reason: "unavailable"; raw: unknown };

function meanPool(matrix: number[][]): number[] {
  const dim = matrix[0]?.length ?? 0;
  const out = new Array(dim).fill(0);
  for (const row of matrix) {
    for (let i = 0; i < dim; i++) out[i] += row[i] ?? 0;
  }
  const n = matrix.length || 1;
  return out.map((v) => v / n);
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function coerceEmbedding(data: unknown): number[] | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    return coerceEmbedding(obj.embeddings ?? obj.embedding ?? obj.data);
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  if (typeof data[0] === "number") {
    return l2Normalize(data as number[]);
  }
  if (typeof data[0] === "string" && !Number.isNaN(Number(data[0]))) {
    return l2Normalize((data as string[]).map(Number));
  }
  if (Array.isArray(data[0]) && typeof data[0][0] === "number") {
    return l2Normalize(meanPool(data as number[][]));
  }
  if (Array.isArray(data[0]) && Array.isArray(data[0][0])) {
    return coerceEmbedding(data[0]);
  }
  return null;
}

export async function embedText(text: string): Promise<EmbeddingOutcome> {
  const apiKey = (process.env.HF_API_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!apiKey) {
    return { ok: false, reason: "unavailable", raw: { error: "HF_API_KEY missing" } };
  }

  try {
    const response = await fetchWithTimeout(
      HF_EMBED_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: text.slice(0, 4000) }),
      },
      HF_TIMEOUT_MS,
    );

    if (isRetryableHttpStatus(response.status) || response.status === 408 || !response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("🤗 HF HTTP", response.status, body.slice(0, 300));
      return {
        ok: false,
        reason: "unavailable",
        raw: { error: "hf_unavailable", status: response.status, body: body.slice(0, 500) },
      };
    }

    const data = await response.json();
    const embedding = coerceEmbedding(data);
    if (!embedding) {
      console.warn("🤗 HF embedding shape not recognized");
      return { ok: false, reason: "unavailable", raw: { error: "hf_bad_shape", data } };
    }
    if (!loggedLiveCall) {
      loggedLiveCall = true;
      console.log("🤗 Hugging Face embeddings via Inference Providers API (all-MiniLM-L6-v2)");
    }
    return { ok: true, embedding };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown hf error";
    const status = err instanceof ProviderUnavailableError ? err.status : undefined;
    return { ok: false, reason: "unavailable", raw: { error: "hf_unavailable", message, status } };
  }
}
