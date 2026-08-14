export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export type RankedMatch<T> = {
  item: T;
  score: number;
  snippet: string;
};

function asVector(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (typeof value[0] !== "number") return null;
  return value as number[];
}

export function topKByCosine<T extends { embedding: unknown; snippetSource: string }>(
  query: number[],
  candidates: T[],
  k: number,
): RankedMatch<T>[] {
  const scored: RankedMatch<T>[] = [];
  for (const item of candidates) {
    const vec = asVector(item.embedding);
    if (!vec) continue;
    const score = cosineSimilarity(query, vec);
    scored.push({
      item,
      score,
      snippet: item.snippetSource.slice(0, 180),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
