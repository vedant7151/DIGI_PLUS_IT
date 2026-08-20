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
                                               │  │ Adapter          │ │    openai/gpt-oss-120b,
                                               │  ├──────────────────┤ │    JSON mode
                                               │  │ Embedding Service│ │──▶ HF Inference Providers API
                                               │  │ (adapter)        │ │    (feature-extraction,
                                               │  ├──────────────────┤ │    all-MiniLM-L6-v2)
                                               │  │ Retrieval Service│ │
                                               │  │ (cosine sim)     │ │
                                               │  └──────────────────┘ │
                                               │           │            │
                                               │           ▼            │
                                               │   MongoDB Atlas         │
                                               │   (incidents,           │
                                               │    kb_articles)         │
                                               └───────────────────────┘
                                                          ▲
                                                          │ one-time seed
                                               ┌───────────────────────┐
                                               │ seed.ts: cached HF     │
                                               │ CSV → Atlas + HF       │
                                               │ embeddings (throttled) │
                                               └───────────────────────┘
```

**Design principle:** the frontend never talks to any AI provider directly. All AI calls are server-side, behind two thin adapters — `AIProvider` (Groq, classification/summary) and `EmbeddingProvider` (Hugging Face Inference Providers, embeddings) — so API keys stay server-side and every AI interaction is logged/auditable in one place. No model runs inside the app process; both classification and embeddings are hosted, free-tier API calls. **Free-tier principle:** because embeddings are the highest-frequency AI operation (every KB article, every incident, every re-embed on edit), that path is the most likely to hit a rate limit or cold start — so it gets the same graceful-degradation treatment as classification (§7), not an exemption from it.

---

## 2. Data Model (MongoDB collections)

```
incidents
 ├─ _id
 ├─ title
 ├─ description
 ├─ status             (open | in_progress | resolved | closed)
 ├─ category           (AI-suggested, human-editable)
 ├─ priority           (AI-suggested, human-editable)
 ├─ aiSummary          (nullable — Groq, persisted independently)
 ├─ aiRawResponse      (nullable JSON — Groq audit trail)
 ├─ embedding          (number[] | null — HF, persisted independently)
 ├─ resolutionNotes
 ├─ resolutionCategory
 ├─ createdAt / updatedAt

kb_articles
 ├─ _id
 ├─ title
 ├─ content
 ├─ source             ("seed:hf-dataset" | "manual")
 ├─ embedding

Similarity (query-time only — not a collection)
 ├─ related incident | KB article
 ├─ score              (cosine similarity)
```

**Design decision — why store `aiRawResponse`:** Grading rewards "AI: appropriate use, reasoning and reliability." Persisting the raw model response (not just the parsed fields) makes AI decisions inspectable/debuggable and demonstrates the AI is actually being called live, not mocked — directly supports auditability (NFR from PRD).

---

## 3. Core Flow — Creating & Analyzing an Incident

1. **User submits** title + description via the create form (client-side validation: required fields, min length).
2. **Backend persists immediately** with `status = open`, `category/priority = null`. *(This ordering matters — see trade-off below.)*
3. **Backend triggers AI analysis** (can be synchronous for the assessment demo, given small scale):
   - Groq `AIProvider.classifyIncident` → `{ category, priority, summary }` (`openai/gpt-oss-120b`, JSON mode). **Written as soon as Groq returns**, even if embeddings are still running.
   - HF `embedText(title + description)` → vector. **Written independently**; cosine vs resolved/closed incidents + KB → top-k.
4. Frontend polls/refreshes the detail page. Classification retry and similarity retry are separate buttons (toasts on those actions).
5. Detail UI:
   - Editable category/priority/summary (`"🤖 AI Suggested"` when Groq populated them)
   - Similar past incidents with similarity % (high % = likely duplicate; engineer decides)
   - Relevant KB articles with scores

**Design decision — persist before analyzing, not "analyze then save":** If the AI call fails or times out, the incident still exists (FR1/NFR: AI failure must not block core CRUD). The UI shows an "AI analysis pending / retry" state rather than losing the user's report. This is the single most important reliability decision in the design.

---

## 4. Core Flow — Resolving an Incident

1. Engineer reviews AI suggestions + similar tickets/KB.
2. Engineer writes `resolution_notes`, sets `resolution_category`, changes `status → resolved`.
3. After a successful resolve, the UI **navigates back to the incident list** (`/`). The ticket’s embedding (if present) is now eligible as a “similar past incident” for later tickets.

---

## 5. UX / UI Design

### Screens
1. **Incident List** — table/card view, filter by status/category/priority, **keyword search** (AND-match words in title/description/summary/category/status/priority/resolution — frontend only, no AI), emoji-coded priority (🔴 High / 🟡 Medium / 🟢 Low) and status (🆕 Open / 🔧 In Progress / ✅ Resolved).
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

- **Classification prompt (Groq, `openai/gpt-oss-120b`):** system prompt fixes the category taxonomy (Network, Hardware, Software/App, Account/Access, Other) and priority scale (Low/Medium/High/Critical), and instructs **strict JSON** via Groq JSON mode. Parser is tolerant of markdown fences and field aliases. Failures leave fields null and show Retry (never crash the request).
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
| Atlas unreachable / timeout | `/health` fails; create/list return 500 + toast. No local Mongo fallback. |
| No similar incidents/KB found | UI shows "No related information found" rather than an empty broken panel |
| DB write failure | Standard 500 + toast notification; nothing is silently lost |

---

## 8. Why This Design Satisfies the Assessment Rubric

| Rubric Area | How this design addresses it |
|---|---|
| Functionality | Full incident lifecycle (create → analyze → investigate → resolve) works end-to-end |
| AI | Live classification + embeddings-based retrieval, structured/validated output, not hardcoded rules |
| Engineering | Adapter pattern isolates Groq and HF; MongoDB Atlas + native driver; persist-first create; independent Groq/HF writes |
| Data | Cached HF dataset seeds Atlas; document collections with stored vectors; free-tier hosted so data is not tied to one laptop |
| UX | Editable AI suggestions, provenance shown, emoji-coded scannability, non-blocking AI |
| Problem solving | Every major choice (DB, vector search, sync-vs-async AI, provider, and the free-tier-only constraint itself) is a documented, justified trade-off, not a default |
