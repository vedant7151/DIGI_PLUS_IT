export const CATEGORIES = ["Network", "Hardware", "Software/App", "Account/Access", "Other", "Uncategorized"] as const;
export const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];
export type AnalysisState = "pending" | "ready" | "unavailable";

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

export type SimilarIncident = {
  id: string;
  title: string;
  category: string | null;
  priority: string | null;
  status: string;
  resolutionNotes: string | null;
  score: number;
  snippet: string;
};

export type KbMatch = {
  id: string;
  title: string;
  source: string;
  score: number;
  snippet: string;
};

export type IncidentDetail = {
  incident: Incident;
  similarIncidents: SimilarIncident[];
  kbMatches: KbMatch[];
  analysis: {
    classification: AnalysisState;
    similarity: AnalysisState;
  };
};

export type AnalyticsSummary = {
  total: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
};

export const PRIORITY_EMOJI: Record<string, string> = {
  Critical: "🔴",
  High: "🔴",
  Medium: "🟡",
  Low: "🟢",
};

export const STATUS_EMOJI: Record<string, string> = {
  open: "🆕",
  in_progress: "🔧",
  resolved: "✅",
  closed: "✅",
};

export const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};
