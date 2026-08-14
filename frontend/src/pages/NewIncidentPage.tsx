import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createIncident } from "../api";

export default function NewIncidentPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setFields({});
    const next: Record<string, string> = {};
    if (title.trim().length < 8) next.title = "Title must be at least 8 characters.";
    if (description.trim().length < 20) next.description = "Description must be at least 20 characters.";
    if (Object.keys(next).length) {
      setFields(next);
      return;
    }
    setSubmitting(true);
    try {
      const data = await createIncident({ title: title.trim(), description: description.trim() });
      navigate(`/incidents/${data.incident.id}`);
    } catch (err) {
      const e = err as Error & { fields?: { field: string; message: string }[] };
      if (e.fields?.length) {
        setFields(Object.fromEntries(e.fields.map((f) => [f.field, f.message])));
      } else {
        setError(e.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">New incident</h1>
      <p className="mt-1 text-sm text-slate-400">
        Ticket is saved immediately. AI classification and similarity run afterward and can fail independently.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
        {error && <div className="rounded-lg bg-rose-950 px-3 py-2 text-sm text-rose-200">{error}</div>}
        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="VPN drops every 10 minutes on WFH"
          />
          {fields.title && <p className="mt-1 text-rose-300">{fields.title}</p>}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            placeholder="What happened, who is affected, and any workaround…"
          />
          {fields.description && <p className="mt-1 text-rose-300">{fields.description}</p>}
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Create ticket"}
        </button>
      </form>
    </div>
  );
}
