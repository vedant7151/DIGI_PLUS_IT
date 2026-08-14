import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listIncidents } from "../api";
import {
  CATEGORIES,
  PRIORITIES,
  PRIORITY_EMOJI,
  STATUS_EMOJI,
  STATUS_LABEL,
  STATUSES,
  type Incident,
} from "../types";

export default function IncidentListPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listIncidents({ status, category, priority })
      .then((data) => {
        setIncidents(data.incidents);
        setError("");
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [status, category, priority]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Incidents</h1>
          <p className="text-sm text-slate-400">Filter by status, category, and priority.</p>
        </div>
        <Link
          to="/new"
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400"
        >
          ➕ New incident
        </Link>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select label="Status" value={status} onChange={setStatus} options={STATUSES.map((s) => [s, `${STATUS_EMOJI[s]} ${STATUS_LABEL[s]}`])} />
        <Select label="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => [c, c])} />
        <Select
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={PRIORITIES.map((p) => [p, `${PRIORITY_EMOJI[p]} ${p}`])}
        />
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <p className="text-slate-400">Loading tickets…</p>}
      {!loading && !error && incidents.length === 0 && (
        <p className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-400">
          No incidents match these filters.
        </p>
      )}

      <ul className="space-y-3">
        {incidents.map((item) => (
          <li key={item.id}>
            <Link
              to={`/incidents/${item.id}`}
              className="block rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-sky-500/60"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  {PRIORITY_EMOJI[item.priority ?? ""] ?? "⚪"} {item.priority ?? "Untriaged"}
                </span>
                <span>
                  {STATUS_EMOJI[item.status] ?? ""} {STATUS_LABEL[item.status] ?? item.status}
                </span>
                <span className="text-slate-500">{item.category ?? "Uncategorized"}</span>
              </div>
              <h2 className="mt-1 font-medium">{item.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-slate-400">{item.aiSummary ?? item.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
      >
        <option value="">All</option>
        {options.map(([v, labelText]) => (
          <option key={v} value={v}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function Banner({ children, tone }: { children: string; tone: "error" }) {
  return <div className="mb-4 rounded-lg bg-rose-950 px-4 py-3 text-sm text-rose-200">{children}</div>;
}
