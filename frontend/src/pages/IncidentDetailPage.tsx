import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { getIncident, retryClassification, retrySimilarity, updateIncident } from "../api";
import Toast from "../Toast";
import {
  CATEGORIES,
  PRIORITIES,
  PRIORITY_EMOJI,
  STATUS_EMOJI,
  STATUS_LABEL,
  STATUSES,
  type IncidentDetail,
} from "../types";


export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<"class" | "sim" | "save" | null>(null);
  const [notes, setNotes] = useState("");
  const [resCategory, setResCategory] = useState("");

  const showToast = (message: string) => setToast(message);
  const navigate = useNavigate();


  const load = useCallback(async () => {
    if (!id) return;
    const data = await getIncident(id);
    setDetail(data);
  }, [id]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    setNotes(detail.incident.resolutionNotes ?? "");
    setResCategory(detail.incident.resolutionCategory ?? detail.incident.category ?? "");
  }, [detail?.incident.id]);

  useEffect(() => {
    if (!detail) return;
    const pending =
      detail.analysis.classification === "pending" || detail.analysis.similarity === "pending";
    if (!pending) return;
    const t = setInterval(() => {
      load().catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [detail, load]);

  if (error) {
    return <div className="rounded-lg bg-rose-950 px-4 py-3 text-rose-200">{error}</div>;
  }
  if (!detail) {
    return <p className="text-slate-400">Loading incident…</p>;
  }

  const { incident, analysis, similarIncidents, kbMatches } = detail;

  async function runClassification() {
    if (!id) return;
    showToast("🤖 Running Groq classification…");
    setBusy("class");
    try {
      setDetail(await retryClassification(id));
      showToast("🤖 Classification finished");
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runSimilarity() {
    if (!id) return;
    showToast("🔍 Fetching embeddings for similarity search…");
    setBusy("sim");
    try {
      setDetail(await retrySimilarity(id));
      showToast("🔍 Similarity search finished");
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!id) return false;
    setBusy("save");
    try {
      const data = await updateIncident(id, body);
      setDetail((prev) => (prev ? { ...prev, incident: data.incident } : prev));
      setToast("Saved.");
      return true;
    } catch (err) {
      setToast((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Toast message={toast} onClear={() => setToast("")} />
      <div className="space-y-6 lg:col-span-2">
        <div>
          <Link to="/" className="text-sm text-sky-400">
            ← All incidents
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{incident.title}</h1>
          <p className="mt-2 whitespace-pre-wrap text-slate-300">{incident.description}</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">🤖 AI analysis</h2>
            <div className="flex flex-wrap gap-2">
              {analysis.classification === "ready" && (
                <span className="rounded-full bg-sky-950 px-2 py-0.5 text-xs text-sky-300">🤖 AI Suggested</span>
              )}
              <button
                type="button"
                disabled={busy === "class"}
                onClick={() => void runClassification()}
                className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              >
                Retry classification
              </button>
              <button
                type="button"
                disabled={busy === "sim"}
                onClick={() => void runSimilarity()}
                className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50"
              >
                Retry similarity
              </button>
            </div>
          </div>

          {analysis.classification === "pending" && (
            <p className="text-sm text-slate-400">Analyzing with Groq… this does not block the ticket.</p>
          )}
          {analysis.classification === "unavailable" && (
            <div className="mb-3 rounded-lg bg-amber-950 px-3 py-2 text-sm text-amber-200">
              Analysis unavailable — Retry
              <button
                className="ml-3 underline"
                disabled={busy === "class"}
                onClick={() => void runClassification()}
              >
                Retry
              </button>
            </div>
          )}

          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-slate-400">Summary</span>
            <textarea
              value={incident.aiSummary ?? ""}
              onChange={(e) =>
                setDetail((prev) =>
                  prev
                    ? { ...prev, incident: { ...prev.incident, aiSummary: e.target.value } }
                    : prev,
                )
              }
              onBlur={(e) => patch({ aiSummary: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              placeholder="AI summary appears here and stays editable"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Category</span>
              <select
                value={incident.category ?? ""}
                onChange={(e) => {
                  if (!e.target.value) return;
                  patch({ category: e.target.value });
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                <option value="">Select…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Priority</span>
              <select
                value={incident.priority ?? ""}
                onChange={(e) => {
                  if (!e.target.value) return;
                  patch({ priority: e.target.value });
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                <option value="">Select…</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_EMOJI[p]} {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-400">Status</span>
              <select
                value={incident.status}
                onChange={(e) => patch({ status: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_EMOJI[s]} {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-3 font-medium">Resolution</h2>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-400">Resolution notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-slate-400">Resolution category</span>
            <select
              value={resCategory}
              onChange={(e) => setResCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">Select…</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            disabled={busy === "save"}
            onClick={async () => {
              const ok = await patch({
                resolutionNotes: notes,
                resolutionCategory: resCategory,
                status: "resolved",
              });
              if (ok) navigate("/");
            }}
          >
            Mark resolved
          </button>
        </section>
      </div>

      <aside className="space-y-6">
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-3 font-medium">Similar incidents</h2>
          {analysis.similarity === "pending" && (
            <p className="text-sm text-slate-400">Fetching embeddings…</p>
          )}
          {analysis.similarity === "unavailable" && (
            <div className="rounded-lg bg-amber-950 px-3 py-2 text-sm text-amber-200">
              Similarity search unavailable — Retry
              <button
                className="ml-2 underline"
                disabled={busy === "sim"}
                onClick={() => void runSimilarity()}
              >
                Retry
              </button>
            </div>
          )}
          {analysis.similarity === "ready" && similarIncidents.length === 0 && (
            <p className="text-sm text-slate-400">No related information found</p>
          )}
          <ul className="space-y-3">
            {similarIncidents.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-800 p-3 text-sm">
                <Link to={`/incidents/${item.id}`} className="font-medium text-sky-300">
                  {item.title}
                </Link>
                <p className="mt-1 text-slate-400">{item.snippet}</p>
                <p className="mt-1 text-xs text-slate-500">
                  similarity {(item.score * 100).toFixed(1)}%
                  {item.resolutionNotes ? ` · fix: ${item.resolutionNotes.slice(0, 80)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-3 font-medium">Relevant KB articles</h2>
          {analysis.similarity === "ready" && kbMatches.length === 0 && (
            <p className="text-sm text-slate-400">No related information found</p>
          )}
          <ul className="space-y-3">
            {kbMatches.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-800 p-3 text-sm">
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-slate-400">{item.snippet}</p>
                <p className="mt-1 text-xs text-slate-500">
                  similarity {(item.score * 100).toFixed(1)}% · {item.source}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
