import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { closeDb, ensureSchema, incidentsCol, kbCol } from "../src/db.js";
import { classifyIncident } from "../src/ai/aiProvider.js";
import { embedText } from "../src/ai/embeddingProvider.js";
import { DATASET_CATEGORY_MAP, DATASET_PRIORITY_MAP, type Category, type Priority } from "../src/constants.js";
import { sleep } from "../src/lib/http.js";

/**
 * Seed approach (documented for evaluators):
 * Prefer a locally cached export of mindweave/help-desk-tickets under backend/data/
 * (tickets.csv, categories.csv, comments.csv). If those files are missing, the script
 * tries to download the same CSVs from Hugging Face. The running app never fetches
 * the dataset at runtime.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const HF_BASE = "https://huggingface.co/datasets/mindweave/help-desk-tickets/resolve/main/data";

const GROQ_GAP_MS = 2500;
const HF_GAP_MS = 1500;
const TICKETS_PER_CATEGORY = 3;

type TicketRow = {
  ticket_id: string;
  priority: string;
  status: string;
  category_id: string;
  summary: string;
  description: string;
};

type CommentRow = { ticket_id: string; visibility: string; body: string };
type CategoryRow = { id: string; name: string };

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => {
        obj[h.trim()] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

async function loadCsv(name: string): Promise<string> {
  const local = path.join(DATA_DIR, name);
  if (fs.existsSync(local)) {
    console.log(`📄 Using cached ${name}`);
    return fs.readFileSync(local, "utf8");
  }
  console.log(`⬇️  Fetching ${name} from Hugging Face…`);
  const res = await fetch(`${HF_BASE}/${name}`);
  if (!res.ok) {
    throw new Error(`Could not load ${name} locally or from Hugging Face (${res.status}).`);
  }
  const text = await res.text();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(local, text);
  return text;
}

function pickSubset(tickets: TicketRow[]): TicketRow[] {
  const byCat = new Map<string, TicketRow[]>();
  for (const t of tickets) {
    if (!t.summary || !t.description) continue;
    const list = byCat.get(t.category_id) ?? [];
    list.push(t);
    byCat.set(t.category_id, list);
  }
  const picked: TicketRow[] = [];
  for (const [, list] of byCat) {
    const resolved = list.filter((t) => t.status === "resolved" || t.status === "closed");
    const pool = resolved.length ? resolved : list;
    picked.push(...pool.slice(0, TICKETS_PER_CATEGORY));
  }
  return picked;
}

function lastPublicComment(comments: CommentRow[], ticketId: string): string | null {
  const bodies = comments.filter((c) => c.ticket_id === ticketId && c.body).map((c) => c.body);
  return bodies.at(-1) ?? null;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const [ticketCsv, categoryCsv, commentCsv] = await Promise.all([
    loadCsv("tickets.csv"),
    loadCsv("categories.csv"),
    loadCsv("comments.csv"),
  ]);

  const categories = parseCsv(categoryCsv) as CategoryRow[];
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const tickets = pickSubset(parseCsv(ticketCsv) as TicketRow[]);
  const comments = parseCsv(commentCsv) as CommentRow[];

  console.log(`🌱 Seeding ${tickets.length} historical incidents + ${categories.length} KB articles`);

  await ensureSchema();
  const incidents = await incidentsCol();
  const articles = await kbCol();
  await incidents.deleteMany({});
  await articles.deleteMany({});

  for (const ticket of tickets) {
    const datasetCategory = catName.get(ticket.category_id) ?? "Other";
    const category: Category = DATASET_CATEGORY_MAP[datasetCategory] ?? "Other";
    const priority: Priority = DATASET_PRIORITY_MAP[ticket.priority] ?? "Medium";
    const resolution = lastPublicComment(comments, ticket.ticket_id);
    const id = randomUUID();
    const title = ticket.summary.slice(0, 180);
    const description = ticket.description;
    const status = ticket.status === "closed" ? "closed" : "resolved";
    const now = new Date();

    await incidents.insertOne({
      _id: id,
      title,
      description,
      status,
      category,
      priority,
      aiSummary: ticket.summary,
      resolutionNotes: resolution,
      resolutionCategory: category,
      embedding: null,
      aiRawResponse: null,
      createdAt: now,
      updatedAt: now,
    } as never);

    const embedding = await embedText(`${title}\n${description}`);
    await incidents.updateOne(
      { _id: id as never },
      {
        $set: {
          embedding: embedding.ok ? embedding.embedding : null,
          aiRawResponse: {
            groq: { source: "dataset-labels", skipped: true },
            embedding: embedding.ok ? { ok: true, dim: embedding.embedding.length } : embedding.raw,
          },
          updatedAt: new Date(),
        },
      },
    );
    if (!embedding.ok) console.log("⚠️  HF embedding unavailable for incident", title);
    await sleep(HF_GAP_MS);
  }

  for (const cat of categories) {
    const related = tickets.filter((t) => t.category_id === cat.id);
    const notes = related
      .map((t) => lastPublicComment(comments, t.ticket_id))
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    const draft = `Common ${cat.name} issues from historical tickets: ${related
      .map((t) => t.summary)
      .join(" ")} Resolution notes: ${notes || "Escalate to the owning team if the first fix fails."}`;

    const groq = await classifyIncident(`KB: ${cat.name}`, draft);
    await sleep(GROQ_GAP_MS);

    const content = groq.ok ? `${groq.result.summary}\n\n${draft}` : draft;
    const articleId = randomUUID();
    const articleTitle = `${cat.name} playbook`;
    const now = new Date();

    await articles.insertOne({
      _id: articleId,
      title: articleTitle,
      content,
      source: "seed:hf-dataset",
      embedding: null,
      createdAt: now,
      updatedAt: now,
    } as never);

    const embedding = await embedText(`${articleTitle}\n${content}`);
    await articles.updateOne(
      { _id: articleId as never },
      {
        $set: {
          embedding: embedding.ok ? embedding.embedding : null,
          updatedAt: new Date(),
        },
      },
    );
    if (!embedding.ok) console.log("⚠️  HF embedding unavailable for KB", articleTitle);
    await sleep(HF_GAP_MS);
  }

  const [incidentCount, kbCount] = await Promise.all([incidents.countDocuments(), articles.countDocuments()]);
  console.log(`✅ Seed complete: ${incidentCount} incidents, ${kbCount} KB articles`);
}

main()
  .catch((err) => {
    console.error("❌ Seed failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
