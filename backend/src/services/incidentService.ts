import { randomUUID } from "node:crypto";
import { incidentsCol, kbCol } from "../db.js";
import { classifyIncident, type ClassificationOutcome } from "../ai/aiProvider.js";
import { embedText } from "../ai/embeddingProvider.js";
import { topKByCosine } from "../ai/retrievalService.js";
import { CATEGORIES, PRIORITIES, STATUSES, type Category, type Priority, type Status } from "../constants.js";
import { mapIncident, mapKb, type Incident, type KBArticle } from "../types.js";

export type FieldError = { field: string; message: string };

export class ValidationError extends Error {
  constructor(public errors: FieldError[]) {
    super("Validation failed");
    this.name = "ValidationError";
  }
}

export type AiRaw = {
  groq?: unknown;
  embedding?: unknown;
};

const inFlight = new Set<string>();

function asAiRaw(value: unknown): AiRaw {
  if (value && typeof value === "object") return value as AiRaw;
  return {};
}

async function findIncident(id: string): Promise<Incident | null> {
  const col = await incidentsCol();
  const doc = await col.findOne({ _id: id as never });
  return doc ? mapIncident(doc as Record<string, unknown>) : null;
}

export function analysisFlags(incident: Incident) {
  const raw = asAiRaw(incident.aiRawResponse);
  const groqDone = raw.groq !== undefined;
  const embedDone = raw.embedding !== undefined;
  const groqUnavailable =
    groqDone &&
    !incident.category &&
    !incident.priority &&
    !incident.aiSummary &&
    Boolean((raw.groq as { error?: string } | undefined)?.error);

  return {
    classification: !groqDone
      ? ("pending" as const)
      : groqUnavailable
        ? ("unavailable" as const)
        : ("ready" as const),
    similarity: !embedDone
      ? ("pending" as const)
      : incident.embedding
        ? ("ready" as const)
        : ("unavailable" as const),
  };
}

export function validateCreate(body: unknown): { title: string; description: string } {
  const errors: FieldError[] = [];
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const description = typeof obj.description === "string" ? obj.description.trim() : "";
  if (!title) errors.push({ field: "title", message: "Title is required." });
  else if (title.length < 8) errors.push({ field: "title", message: "Title must be at least 8 characters." });
  if (!description) errors.push({ field: "description", message: "Description is required." });
  else if (description.length < 20) {
    errors.push({ field: "description", message: "Description must be at least 20 characters." });
  }
  if (errors.length) throw new ValidationError(errors);
  return { title, description };
}

export async function createIncident(input: { title: string; description: string }) {
  const now = new Date();
  const id = randomUUID();
  const col = await incidentsCol();
  const doc = {
    _id: id,
    title: input.title,
    description: input.description,
    status: "open",
    category: null,
    priority: null,
    aiSummary: null,
    aiRawResponse: null,
    embedding: null,
    resolutionNotes: null,
    resolutionCategory: null,
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc as never);
  void enrichIncident(id);
  return mapIncident(doc);
}

export async function enrichIncident(id: string): Promise<Incident | null> {
  if (inFlight.has(id)) return findIncident(id);
  inFlight.add(id);
  try {
    const incident = await findIncident(id);
    if (!incident) return null;
    const [classification, embedding] = await Promise.all([
      classifyIncident(incident.title, incident.description),
      embedText(`${incident.title}\n${incident.description}`),
    ]);
    return persistAnalysis(incident, classification, embedding);
  } finally {
    inFlight.delete(id);
  }
}

function fieldsFromClassification(classification: ClassificationOutcome) {
  if (classification.ok) {
    return {
      category: classification.result.category,
      priority: classification.result.priority,
      aiSummary: classification.result.summary,
      aiRawGroq: classification.result.raw,
    };
  }
  if (classification.reason === "parse_fallback") {
    return {
      category: "Uncategorized",
      priority: "Medium" as Priority,
      aiSummary: null as string | null,
      aiRawGroq: classification.raw,
    };
  }
  return {
    category: null as string | null,
    priority: null as string | null,
    aiSummary: null as string | null,
    aiRawGroq: classification.raw,
  };
}

async function persistAnalysis(
  incident: Incident,
  classification: ClassificationOutcome,
  embedding: Awaited<ReturnType<typeof embedText>>,
) {
  const groqFields = fieldsFromClassification(classification);
  const raw: AiRaw = {
    groq: groqFields.aiRawGroq,
    embedding: embedding.ok ? { ok: true, dim: embedding.embedding.length } : embedding.raw,
  };
  const col = await incidentsCol();
  await col.updateOne(
    { _id: incident.id as never },
    {
      $set: {
        category: groqFields.category,
        priority: groqFields.priority,
        aiSummary: groqFields.aiSummary,
        embedding: embedding.ok ? embedding.embedding : null,
        aiRawResponse: raw,
        updatedAt: new Date(),
      },
    },
  );
  return findIncident(incident.id);
}

export async function retryClassification(id: string): Promise<Incident | null> {
  const incident = await findIncident(id);
  if (!incident) return null;
  const classification = await classifyIncident(incident.title, incident.description);
  const raw = asAiRaw(incident.aiRawResponse);
  const patch = fieldsFromClassification(classification);
  const col = await incidentsCol();
  await col.updateOne(
    { _id: id as never },
    {
      $set: {
        category: patch.category,
        priority: patch.priority,
        aiSummary: patch.aiSummary,
        aiRawResponse: { ...raw, groq: patch.aiRawGroq },
        updatedAt: new Date(),
      },
    },
  );
  return findIncident(id);
}

export async function retrySimilarity(id: string): Promise<Incident | null> {
  const incident = await findIncident(id);
  if (!incident) return null;
  const embedding = await embedText(`${incident.title}\n${incident.description}`);
  const raw = asAiRaw(incident.aiRawResponse);
  const col = await incidentsCol();
  await col.updateOne(
    { _id: id as never },
    {
      $set: {
        embedding: embedding.ok ? embedding.embedding : null,
        aiRawResponse: {
          ...raw,
          embedding: embedding.ok ? { ok: true, dim: embedding.embedding.length } : embedding.raw,
        },
        updatedAt: new Date(),
      },
    },
  );
  return findIncident(id);
}

export async function listIncidents(filters: {
  status?: string;
  category?: string;
  priority?: string;
}) {
  const where: Record<string, string> = {};
  if (filters.status) where.status = filters.status;
  if (filters.category) where.category = filters.category;
  if (filters.priority) where.priority = filters.priority;
  const col = await incidentsCol();
  const docs = await col.find(where).sort({ createdAt: -1 }).toArray();
  return docs.map((d) => mapIncident(d as Record<string, unknown>));
}

export async function getIncident(id: string) {
  const incident = await findIncident(id);
  if (!incident) return null;

  const flags = analysisFlags(incident);
  const queryVec = incident.embedding;

  let similarIncidents: ReturnType<typeof serializeSimilar> = [];
  let kbMatches: ReturnType<typeof serializeKb> = [];

  if (queryVec) {
    const [incidents, articles] = await Promise.all([
      (await incidentsCol())
        .find({ _id: { $ne: id as never }, status: { $in: ["resolved", "closed"] } })
        .toArray(),
      (await kbCol()).find({}).toArray(),
    ]);

    similarIncidents = serializeSimilar(
      topKByCosine(
        queryVec,
        incidents.map((row) => {
          const item = mapIncident(row as Record<string, unknown>);
          return {
            ...item,
            snippetSource: item.resolutionNotes || item.aiSummary || item.description,
          };
        }),
        5,
      ),
    );

    kbMatches = serializeKb(
      topKByCosine(
        queryVec,
        articles.map((row) => {
          const item = mapKb(row as Record<string, unknown>);
          return { ...item, snippetSource: item.content };
        }),
        5,
      ),
    );
  }

  return { incident, similarIncidents, kbMatches, analysis: flags };
}

function serializeSimilar(
  matches: { item: Incident & { snippetSource: string }; score: number; snippet: string }[],
) {
  return matches.map((m) => ({
    id: m.item.id,
    title: m.item.title,
    category: m.item.category,
    priority: m.item.priority,
    status: m.item.status,
    resolutionNotes: m.item.resolutionNotes,
    score: Number(m.score.toFixed(4)),
    snippet: m.snippet,
  }));
}

function serializeKb(
  matches: { item: KBArticle & { snippetSource: string }; score: number; snippet: string }[],
) {
  return matches.map((m) => ({
    id: m.item.id,
    title: m.item.title,
    source: m.item.source,
    score: Number(m.score.toFixed(4)),
    snippet: m.snippet,
  }));
}

export async function updateIncident(
  id: string,
  body: Record<string, unknown>,
): Promise<Incident | null> {
  const existing = await findIncident(id);
  if (!existing) return null;

  const next = { ...existing };
  if (typeof body.title === "string") next.title = body.title.trim();
  if (typeof body.description === "string") next.description = body.description.trim();
  if (typeof body.status === "string") {
    if (!STATUSES.includes(body.status as Status)) {
      throw new ValidationError([{ field: "status", message: "Invalid status." }]);
    }
    next.status = body.status;
  }
  if (typeof body.category === "string") {
    const allowed = [...CATEGORIES, "Uncategorized"];
    if (!allowed.includes(body.category as Category)) {
      throw new ValidationError([{ field: "category", message: "Invalid category." }]);
    }
    next.category = body.category;
  }
  if (typeof body.priority === "string") {
    if (!PRIORITIES.includes(body.priority as Priority)) {
      throw new ValidationError([{ field: "priority", message: "Invalid priority." }]);
    }
    next.priority = body.priority;
  }
  if (typeof body.aiSummary === "string") next.aiSummary = body.aiSummary;
  if (typeof body.resolutionNotes === "string" || typeof body.resolution_notes === "string") {
    next.resolutionNotes = String(body.resolutionNotes ?? body.resolution_notes);
  }
  if (typeof body.resolutionCategory === "string" || typeof body.resolution_category === "string") {
    next.resolutionCategory = String(body.resolutionCategory ?? body.resolution_category);
  }

  const col = await incidentsCol();
  await col.updateOne(
    { _id: id as never },
    {
      $set: {
        title: next.title,
        description: next.description,
        status: next.status,
        category: next.category,
        priority: next.priority,
        aiSummary: next.aiSummary,
        resolutionNotes: next.resolutionNotes,
        resolutionCategory: next.resolutionCategory,
        updatedAt: new Date(),
      },
    },
  );

  let updated = await findIncident(id);
  if (!updated) return null;

  const descriptionChanged = next.description !== existing.description;
  const becomingResolved = next.status === "resolved" || next.status === "closed";

  if (becomingResolved && (descriptionChanged || !updated.embedding)) {
    const embedding = await embedText(`${updated.title}\n${updated.description}`);
    if (embedding.ok) {
      const raw = asAiRaw(updated.aiRawResponse);
      await col.updateOne(
        { _id: id as never },
        {
          $set: {
            embedding: embedding.embedding,
            aiRawResponse: { ...raw, embedding: { ok: true, dim: embedding.embedding.length } },
            updatedAt: new Date(),
          },
        },
      );
      updated = await findIncident(id);
    }
  }

  return updated;
}

export async function listKbArticles() {
  const col = await kbCol();
  const docs = await col.find({}).sort({ createdAt: -1 }).toArray();
  return docs.map((row) => {
    const article = mapKb(row as Record<string, unknown>);
    const { embedding: _e, ...rest } = article;
    return rest;
  });
}

export async function analyticsSummary() {
  const col = await incidentsCol();
  const incidents = await col
    .find({}, { projection: { category: 1, priority: 1, status: 1 } })
    .toArray();
  const tally = (key: "category" | "priority" | "status") => {
    const counts: Record<string, number> = {};
    for (const row of incidents) {
      const value = (row[key] as string | null | undefined) ?? "Uncategorized";
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  };
  return {
    total: incidents.length,
    byCategory: tally("category"),
    byPriority: tally("priority"),
    byStatus: tally("status"),
  };
}
