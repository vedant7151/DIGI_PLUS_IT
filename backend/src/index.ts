import "dotenv/config";
import cors from "cors";
import express from "express";
import { ensureSchema, pingDb } from "./db.js";
import { incidentRouter } from "./routes/incidents.js";
import { analyticsRouter, kbRouter } from "./routes/kb.js";

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    await ensureSchema();
    await pingDb();
    res.json({ ok: true, db: "connected" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown database error";
    res.status(503).json({
      ok: false,
      db: "unavailable",
      message: "Could not reach MongoDB. Set MONGODB_URI in backend/.env (Atlas free tier is fine).",
      detail: message,
    });
  }
});

app.use("/api", async (_req, res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown database error";
    res.status(500).json({
      error: "server_error",
      message: "Could not reach MongoDB. Check MONGODB_URI.",
      detail: message,
    });
  }
});

app.use("/api/incidents", incidentRouter);
app.use("/api/kb", kbRouter);
app.use("/api/analytics", analyticsRouter);

const server = app.listen(PORT, () => {
  console.log(`🛠️  Service desk API listening on http://localhost:${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process, then run npm run dev again.`);
    process.exit(1);
  }
  throw err;
});
