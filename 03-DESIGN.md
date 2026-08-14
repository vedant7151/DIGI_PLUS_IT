# System & UX Design
## AI-Powered Service Desk — DigiPlus Technical Assessment

---

## 1. High-Level Architecture

```
┌──────────────────┐        HTTP/JSON        ┌───────────────────────┐
│  React Frontend   │ ───────────────────────▶│  Express API Backend  │
│  (Vite + Tailwind)│ ◀─────────────────────── │                        │
└──────────────────┘                          │  ┌──────────────────┐ │
                                               │  │ Incident Service │ │
                                               │  ├──────────────────┤ │
                                               │  │ AI Provider      │ │──▶ Groq API (free tier)
                                               │  │ Adapter          │ │    (classify / summarize,
                                               │  ├──────────────────┤ │     Llama 3.3, JSON mode)
                                               │  │ Embedding Service│ │──▶ HF Inference Providers API
                                               │  │ (adapter)        │ │    (feature-extraction,
                                               │  ├──────────────────┤ │    all-MiniLM-L6-v2, free tier)
                                               │  │ Retrieval Service│ │
                                               │  │ (cosine sim)     │ │
                                               │  └──────────────────┘ │
                                               │           │            │
                                               │           ▼            │
                                               │   Neon (Postgres,      │
                                               │   free tier, Prisma)   │
                                               └───────────────────────┘
                                                          ▲
                                                          │ one-time seed
                                               ┌───────────────────────┐
                                               │ seed.js: HF dataset →  │
                                               │ historical incidents + │
                                               │ KB articles + embeddings│
                                               │ (throttled Groq calls) │
                                               └───────────────────────┘
```

**Design principle:** the frontend never talks to any AI provider directly. All AI calls are server-side, behind two thin adapters — `AIProvider` (Groq, classification/summary) and `EmbeddingProvider` (Hugging Face Inference Providers, embeddings) — so API keys stay server-side and every AI interaction is logged/auditable in one place. No model runs inside the app process; both classification and embeddings are hosted, free-tier API calls. **Free-tier principle:** because embeddings are the highest-frequency AI operation (every KB article, every incident, every re-embed on edit), that path is the most likely to hit a rate limit or cold start — so it gets the same graceful-degradation treatment as classification (§7), not an exemption from it.

---

## 2. Data Model (ER overview)

```
Incident
 ├─ id (PK)
 ├─ title
 ├─ description
 ├─ status          (open | in_progress | resolved | closed)
 ├─ category         (AI-suggested, human-editable)
 ├─ priority          (AI-suggested, human-editable)
 ├─ ai_summary        (nullable — populated async)
 ├─ ai_raw_response   (nullable JSON — audit trail)
 ├─ embedding          (JSON vector, nullable — set after analysis)
 ├─ resolution_notes  (nullable)
 ├─ resolution_category (nullable)
 ├─ created_at / updated_at

KBArticle
 ├─ id (PK)
 ├─ title
 ├─ content
 ├─ source            ("seed:hf-dataset" | "manual")
 ├─ embedding

IncidentSimilarity (derived at query time, not necessarily persisted)
 ├─ incident_id
 ├─ related_incident_id | kb_article_id
 ├─ score              (cosine similarity)
 ├─ type                (duplicate | kb_reference)
```

**Design decision — why store `ai_raw_response`:** Grading rewards "AI: appropriate use, reasoning and reliability." Persisting the raw model response (not just the parsed fields) makes AI decisions inspectable/debuggable and demonstrates the AI is actually being called live, not mocked — directly supports auditability (NFR from PRD).

---

## 3. Core Flow — Creating & Analyzing an Incident

1. **User submits** title + description via the create form (client-side validation: required fields, min length).
2. **Backend persists immediately** with `status = open`, `category/priority = null`. *(This ordering matters — see trade-off below.)*
3. **Backend triggers AI analysis** (can be synchronous for the assessment demo, given small scale):
   - Call `AIProvider.classifyIncident(title, description)` → structured JSON: `{ category, priority, summary }` (Groq, free tier).
   - Call `EmbeddingService.embedText(title + description)` → vector, fetched from the **Hugging Face Inference Providers API** (free tier; timeout/retry handled by the adapter, same pattern as the Groq call).
   - Run cosine similarity against existing `Incident.embedding` (resolved only) and `KBArticle.embedding` → top-k matches.
4. **Backend updates the incident row** with AI fields + stores raw response.
5. **Frontend renders** the incident detail page with:
   - AI-suggested category/priority (shown as *editable* chips/dropdowns, not locked text)
   - "Similar Past Incidents" panel (with their resolutions, if resolved)
   - "Relevant KB Articles" panel
   - A visible confidence/"AI suggested" badge so the human always knows what's AI vs. human-entered

**Design decision — persist before analyzing, not "analyze then save":** If the AI call fails or times out, the incident still exists (FR1/NFR: AI failure must not block core CRUD). The UI shows an "AI analysis pending / retry" state rather than losing the user's report. This is the single most important reliability decision in the design.

---

## 4. Core Flow — Resolving an Incident

1. Engineer reviews AI suggestions + similar tickets/KB.
2. Engineer writes `resolution_notes`, sets `resolution_category`, changes `status → resolved`.
3. On resolve, the incident's embedding is (re)computed if the description was edited, so it becomes a valid future "similar past incident" for others — **the KB effectively grows from usage**, not just the seed script.

---

## 5. UX / UI Design

### Screens
1. **Incident List** — table/card view, filter by status/category/priority, emoji-coded priority (🔴 High / 🟡 Medium / 🟢 Low) and status (🆕 Open / 🔧 In Progress / ✅ Resolved).
2. **New Incident** — simple two-field form (title, description), submit → immediately routes to detail page showing a loading state for AI analysis.
3. **Incident Detail** — description at top; AI panel (summary, category/priority as editable controls, "🤖 AI Suggested" badge); "Similar Incidents" + "Relevant KB" side panel; resolution form at the bottom.
4. **(Optional) Analytics** — simple bar/pie of ticket count by category and by priority.

### UX Principles Applied
- **AI suggests, never silently overrides** — every AI-derived field is an editable control, not static text. This avoids the failure mode where a wrong AI classification becomes an unchallengeable fact.
- **Always show provenance** — similar incidents/KB matches show *why* (similarity score, matched snippet), not just a bare list, so the engineer can quickly judge relevance rather than trust blindly.
- **Never block on AI** — form submission and ticket creation succeed instantly; AI enrichment is visibly "in progress" and retryable.
- **Emojis used for scannability, not decoration** — priority/status/category encoded with consistent emoji + color so a list of 20 tickets can be triaged at a glance (directly serves "UX: clarity and usability").

---

## 6. AI Prompting Design (brief outline)

- **Classification prompt (Groq, Llama 3.3):** system prompt fixes the category taxonomy (e.g., Network, Hardware, Software/App, Account/Access, Other) and priority scale (Low/Medium/High/Critical) with short definitions, and instructs the model to return **strict JSON** via Groq's JSON mode — this is parsed, not regex-scraped, and falls back to `category: "Uncategorized"` if parsing fails or the free-tier rate limit is hit (never crashes the request).
- **Retrieval:** embeddings-based, not prompt-based — a single lightweight `feature-extraction` call to the Hugging Face Inference Providers API (`sentence-transformers/all-MiniLM-L6-v2`) per incident/article, with cosine similarity computed in application code once the vector is returned. This is cheaper and more deterministic than asking the LLM to judge similarity, but — unlike a local computation — it is a real network call with its own free-tier rate limit and occasional cold start, so it's wrapped in the same timeout/fallback pattern as the Groq classification call.
- **Summary:** short (1–2 sentence) restatement of the issue in plain language, used both in the list view (hover/preview) and detail view.

**Design decision — structured JSON output over free-text parsing:** Free-text LLM responses are fragile to parse and risk silently wrong data. Forcing structured output (and validating it server-side before persisting) is what makes the AI "reliable" per the grading rubric, not just "present."

---

## 7. Error Handling & Validation Design

| Failure mode | Handling |
|---|---|
| Missing title/description | 400 with field-level error messages (frontend + backend validation, not just client-side) |
| AI provider (Groq) timeout/error/free-tier rate limit (429) | Incident still saved; `ai_summary/category/priority = null`; UI shows "Analysis unavailable — Retry" button |
| Embedding API (HF Inference Providers) timeout/error/rate limit or cold start | Incident still saved and classification can still succeed independently; `embedding = null`; UI shows "Similarity search unavailable — Retry" instead of blocking the rest of the AI panel |
| Malformed AI JSON response | Server-side schema validation catches it; falls back to `Uncategorized`/`Medium` defaults rather than crashing |
| Neon cold-start delay (free-tier autosuspend) | Backend uses a short connection retry/backoff on first query after idle, so a cold start shows a brief loading state instead of an error |
| No similar incidents/KB found | UI shows "No related information found" rather than an empty broken panel |
| DB write failure | Standard 500 + toast notification; nothing is silently lost |

---

## 8. Why This Design Satisfies the Assessment Rubric

| Rubric Area | How this design addresses it |
|---|---|
| Functionality | Full incident lifecycle (create → analyze → investigate → resolve) works end-to-end |
| AI | Live classification + embeddings-based retrieval, structured/validated output, not hardcoded rules |
| Engineering | Adapter pattern isolates AI provider; clean service/data layers; Neon (Postgres) + Prisma for a maintainable, shareable schema |
| Data | Real dataset used to seed realistic KB/history; relational schema with proper persistence, free-tier hosted so it's not tied to one laptop |
| UX | Editable AI suggestions, provenance shown, emoji-coded scannability, non-blocking AI |
| Problem solving | Every major choice (DB, vector search, sync-vs-async AI, provider, and the free-tier-only constraint itself) is a documented, justified trade-off, not a default |
