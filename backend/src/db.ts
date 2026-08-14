import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, type Collection, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

const globalForMongo = globalThis as unknown as {
  mongo?: { client: MongoClient; db: Db; mongod?: MongoMemoryServer };
};

function atlasUri(): string | null {
  const raw = (process.env.MONGODB_URI ?? "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw || raw.startsWith("postgres")) return null;
  return raw;
}

const clientOptions = {
  family: 4 as const,
  tls: true,
  serverSelectionTimeoutMS: 12_000,
  connectTimeoutMS: 10_000,
};

async function connectAtlas(uri: string): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(uri, clientOptions);
  await client.connect();
  const db = client.db();
  await db.command({ ping: 1 });
  console.log("🍃 Connected to MongoDB Atlas");
  return { client, db };
}

async function connectLocal(): Promise<{ client: MongoClient; db: Db; mongod: MongoMemoryServer }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dbPath = path.resolve(here, "../.data/mongo");
  fs.mkdirSync(dbPath, { recursive: true });

  const mongod = await MongoMemoryServer.create({
    instance: {
      dbPath,
      storageEngine: "wiredTiger",
    },
  });
  const client = new MongoClient(mongod.getUri(), {
    serverSelectionTimeoutMS: 20_000,
  });
  await client.connect();
  const db = client.db();
  console.log("🍃 Atlas unreachable — using local MongoDB at", mongod.getUri());
  return { client, db, mongod };
}

async function connect(): Promise<{ client: MongoClient; db: Db; mongod?: MongoMemoryServer }> {
  if (globalForMongo.mongo) return globalForMongo.mongo;

  const uri = atlasUri();
  if (uri) {
    try {
      const atlas = await connectAtlas(uri);
      globalForMongo.mongo = atlas;
      return atlas;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("⚠️  Atlas connection failed:", message);
      console.warn("   Add your IP under Atlas → Network Access (or 0.0.0.0/0 for a demo), then retry.");
      console.warn("   Falling back to a local MongoDB so the app can still run.");
    }
  }

  const local = await connectLocal();
  globalForMongo.mongo = local;
  return local;
}

export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (globalForMongo.mongo?.mongod) {
        await globalForMongo.mongo.mongod.stop().catch(() => undefined);
      }
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
  await globalForMongo.mongo.mongod?.stop().catch(() => undefined);
  globalForMongo.mongo = undefined;
}
