import { fetchWithTimeout, isRetryableHttpStatus, ProviderUnavailableError } from "../lib/http.js";

const HF_EMBED_URL =
  "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction";
const HF_TIMEOUT_MS = 20_000;

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
  if (!Array.isArray(data) || data.length === 0) return null;
  if (typeof data[0] === "number") {
    return l2Normalize(data as number[]);
  }
  if (Array.isArray(data[0]) && typeof data[0][0] === "number") {
    return l2Normalize(meanPool(data as number[][]));
  }
  // Some providers wrap a single vector as [[f, f, ...]]
  if (Array.isArray(data[0]) && Array.isArray(data[0][0])) {
    return coerceEmbedding(data[0]);
  }
  return null;
}

export async function embedText(text: string): Promise<EmbeddingOutcome> {
  const apiKey = process.env.HF_API_KEY;
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
      return {
        ok: false,
        reason: "unavailable",
        raw: { error: "hf_unavailable", status: response.status, body: body.slice(0, 500) },
      };
    }

    const data = await response.json();
    const embedding = coerceEmbedding(data);
    if (!embedding) {
      return { ok: false, reason: "unavailable", raw: { error: "hf_bad_shape", data } };
    }
    return { ok: true, embedding };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown hf error";
    const status = err instanceof ProviderUnavailableError ? err.status : undefined;
    return { ok: false, reason: "unavailable", raw: { error: "hf_unavailable", message, status } };
  }
}
