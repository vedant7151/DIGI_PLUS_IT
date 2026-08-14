export const CATEGORIES = [
  "Network",
  "Hardware",
  "Software/App",
  "Account/Access",
  "Other",
] as const;

export const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

export const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];

export const DATASET_CATEGORY_MAP: Record<string, Category> = {
  "Access Management": "Account/Access",
  "Laptop / Endpoint": "Hardware",
  "Network & VPN": "Network",
  "Email & Collaboration": "Software/App",
  "ERP / WMS": "Software/App",
  "Printers & Devices": "Hardware",
  Security: "Account/Access",
  Telephony: "Hardware",
};

export const DATASET_PRIORITY_MAP: Record<string, Priority> = {
  P1: "Critical",
  P2: "High",
  P3: "Medium",
  P4: "Low",
};
