import { Router } from "express";
import { analyticsSummary, listKbArticles } from "../services/incidentService.js";

export const kbRouter = Router();
export const analyticsRouter = Router();

kbRouter.get("/", async (_req, res) => {
  try {
    const articles = await listKbArticles();
    res.json({ articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "server_error",
      message: "Could not load knowledge base articles.",
    });
  }
});

analyticsRouter.get("/", async (_req, res) => {
  try {
    const summary = await analyticsSummary();
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "server_error",
      message: "Could not load analytics.",
    });
  }
});
