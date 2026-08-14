export type Incident = {
  id: string;
  title: string;
  description: string;
  status: string;
  category: string | null;
  priority: string | null;
  aiSummary: string | null;
  aiRawResponse: unknown;
  embedding: number[] | null;
  resolutionNotes: string | null;
  resolutionCategory: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KBArticle = {
  id: string;
  title: string;
  content: string;
  source: string;
  embedding: number[] | null;
  createdAt: string;
  updatedAt: string;
};

function asVector(value: unknown): number[] | null {
  if (!Array.isArray(value) || typeof value[0] !== "number") return null;
  return value as number[];
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value ?? Date.now())).toISOString();
}

export function mapIncident(doc: Record<string, unknown>): Incident {
  return {
    id: String(doc._id ?? doc.id),
    title: String(doc.title),
    description: String(doc.description),
    status: String(doc.status),
    category: doc.category == null ? null : String(doc.category),
    priority: doc.priority == null ? null : String(doc.priority),
    aiSummary: doc.aiSummary == null ? null : String(doc.aiSummary),
    aiRawResponse: doc.aiRawResponse ?? null,
    embedding: asVector(doc.embedding),
    resolutionNotes: doc.resolutionNotes == null ? null : String(doc.resolutionNotes),
    resolutionCategory: doc.resolutionCategory == null ? null : String(doc.resolutionCategory),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

export function mapKb(doc: Record<string, unknown>): KBArticle {
  return {
    id: String(doc._id ?? doc.id),
    title: String(doc.title),
    content: String(doc.content),
    source: String(doc.source),
    embedding: asVector(doc.embedding),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}
