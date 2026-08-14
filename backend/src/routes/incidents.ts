import { Router } from "express";
import {
  ValidationError,
  createIncident,
  enrichIncident,
  getIncident,
  listIncidents,
  retryClassification,
  retrySimilarity,
  updateIncident,
  validateCreate,
} from "../services/incidentService.js";

export const incidentRouter = Router();

function sendError(res: import("express").Response, err: unknown) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: "validation_error", fields: err.errors });
  }
  console.error("DB/request error", err);
  return res.status(500).json({
    error: "server_error",
    message: "Could not complete the request. Nothing was silently discarded.",
  });
}

incidentRouter.post("/", async (req, res) => {
  try {
    const input = validateCreate(req.body);
    const incident = await createIncident(input);
    res.status(201).json({
      incident,
      analysis: { classification: "pending", similarity: "pending" },
    });
  } catch (err) {
    sendError(res, err);
  }
});

incidentRouter.get("/", async (req, res) => {
  try {
    const incidents = await listIncidents({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      priority: typeof req.query.priority === "string" ? req.query.priority : undefined,
    });
    res.json({ incidents });
  } catch (err) {
    sendError(res, err);
  }
});

incidentRouter.get("/:id", async (req, res) => {
  try {
    const detail = await getIncident(req.params.id);
    if (!detail) return res.status(404).json({ error: "not_found" });
    res.json(detail);
  } catch (err) {
    sendError(res, err);
  }
});

incidentRouter.patch("/:id", async (req, res) => {
  try {
    const incident = await updateIncident(req.params.id, req.body ?? {});
    if (!incident) return res.status(404).json({ error: "not_found" });
    res.json({ incident });
  } catch (err) {
    sendError(res, err);
  }
});

incidentRouter.post("/:id/retry-classification", async (req, res) => {
  try {
    const incident = await retryClassification(req.params.id);
    if (!incident) return res.status(404).json({ error: "not_found" });
    const detail = await getIncident(incident.id);
    res.json(detail);
  } catch (err) {
    sendError(res, err);
  }
});

incidentRouter.post("/:id/retry-similarity", async (req, res) => {
  try {
    const incident = await retrySimilarity(req.params.id);
    if (!incident) return res.status(404).json({ error: "not_found" });
    const detail = await getIncident(incident.id);
    res.json(detail);
  } catch (err) {
    sendError(res, err);
  }
});

incidentRouter.post("/:id/analyze", async (req, res) => {
  try {
    const incident = await enrichIncident(req.params.id);
    if (!incident) return res.status(404).json({ error: "not_found" });
    const detail = await getIncident(incident.id);
    res.json(detail);
  } catch (err) {
    sendError(res, err);
  }
});
