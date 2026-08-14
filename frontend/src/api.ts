import type { AnalyticsSummary, Incident, IncidentDetail } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    fields?: { field: string; message: string }[];
  };
  if (!res.ok) {
    const err = new Error(data.message ?? `Request failed (${res.status})`) as Error & {
      status: number;
      fields?: { field: string; message: string }[];
    };
    err.status = res.status;
    err.fields = data.fields;
    throw err;
  }
  return data;
}

export async function getHealth() {
  return request<{ ok: boolean; db?: string; message?: string }>("/health");
}

export async function listIncidents(filters: {
  status?: string;
  category?: string;
  priority?: string;
}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  if (filters.priority) params.set("priority", filters.priority);
  const q = params.toString();
  return request<{ incidents: Incident[] }>(`/api/incidents${q ? `?${q}` : ""}`);
}

export async function createIncident(body: { title: string; description: string }) {
  return request<{ incident: Incident; analysis: { classification: string; similarity: string } }>(
    "/api/incidents",
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function getIncident(id: string) {
  return request<IncidentDetail>(`/api/incidents/${id}`);
}

export async function updateIncident(id: string, body: Record<string, unknown>) {
  return request<{ incident: Incident }>(`/api/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function retryClassification(id: string) {
  return request<IncidentDetail>(`/api/incidents/${id}/retry-classification`, { method: "POST" });
}

export async function retrySimilarity(id: string) {
  return request<IncidentDetail>(`/api/incidents/${id}/retry-similarity`, { method: "POST" });
}

export async function getAnalytics() {
  return request<AnalyticsSummary>("/api/analytics");
}

export { API_URL };
