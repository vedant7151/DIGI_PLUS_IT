import { MongoClient, type Collection, type Db } from "mongodb";

const globalForMongo = globalThis as unknown as {
  mongo?: { client: MongoClient; db: Db };
};

function atlasUri(): string {
  const raw = (process.env.MONGODB_URI ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw || raw.startsWith("postgres")) {
    throw new Error("Set MONGODB_URI in backend/.env to your MongoDB Atlas connection string.");
  }
  return raw;
}

async function connect(): Promise<{ client: MongoClient; db: Db }> {
  if (globalForMongo.mongo) return globalForMongo.mongo;

  const client = new MongoClient(atlasUri(), {
    family: 4,
    tls: true,
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 20_000,
  });
  await client.connect();
  const db = client.db();
  await db.command({ ping: 1 });
  console.log("🍃 Connected to MongoDB Atlas");
  globalForMongo.mongo = { client, db };
  return globalForMongo.mongo;
}

export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await globalForMongo.mongo?.client.close().catch(() => undefined);
      globalForMongo.mongo = undefined;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastError;
}

export async function getDb(): Promise<Db> {
  const { db } = await withDbRetry(() => connect());
  return db;
}

export async function incidentsCol(): Promise<Collection> {
  return (await getDb()).collection("incidents");
}

export async function kbCol(): Promise<Collection> {
  return (await getDb()).collection("kb_articles");
}

let indexesReady = false;

export async function ensureSchema(): Promise<void> {
  if (indexesReady) return;
  const incidents = await incidentsCol();
  const kb = await kbCol();
  await incidents.createIndex({ status: 1 });
  await incidents.createIndex({ category: 1 });
  await incidents.createIndex({ priority: 1 });
  await incidents.createIndex({ createdAt: -1 });
  await kb.createIndex({ createdAt: -1 });
  indexesReady = true;
}

export async function pingDb(): Promise<void> {
  const db = await getDb();
  await db.command({ ping: 1 });
}

export async function closeDb(): Promise<void> {
  if (!globalForMongo.mongo) return;
  await globalForMongo.mongo.client.close().catch(() => undefined);
  globalForMongo.mongo = undefined;
}
