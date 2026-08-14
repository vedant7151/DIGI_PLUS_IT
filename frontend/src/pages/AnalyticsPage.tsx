import { useEffect, useState } from "react";
import { getAnalytics } from "../api";
import { PRIORITY_EMOJI, STATUS_EMOJI, STATUS_LABEL, type AnalyticsSummary } from "../types";

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAnalytics()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <div className="rounded-lg bg-rose-950 px-4 py-3 text-rose-200">{error}</div>;
  if (!data) return <p className="text-slate-400">Loading analytics…</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-slate-400">Ticket volume by category, priority, and status. Total: {data.total}</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <ChartCard title="By category" counts={data.byCategory} />
        <ChartCard
          title="By priority"
          counts={data.byPriority}
          label={(k) => `${PRIORITY_EMOJI[k] ?? ""} ${k}`}
        />
        <ChartCard
          title="By status"
          counts={data.byStatus}
          label={(k) => `${STATUS_EMOJI[k] ?? ""} ${STATUS_LABEL[k] ?? k}`}
        />
      </div>
    </div>
  );
}

function ChartCard({
  title,
  counts,
  label,
}: {
  title: string;
  counts: Record<string, number>;
  label?: (key: string) => string;
}) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-4 font-medium">{title}</h2>
      {entries.length === 0 && <p className="text-sm text-slate-400">No data yet.</p>}
      <ul className="space-y-3">
        {entries.map(([key, n]) => (
          <li key={key}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{label ? label(key) : key}</span>
              <span className="text-slate-400">{n}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-sky-500" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
