# Tech Stack Decisions
## AI-Powered Service Desk — DigiPlus Technical Assessment

Every decision below is framed with **STAR** (Situation, Task, Action, Result) so it can be explained/defended in an interview — this is what an interviewer is really testing when they say "explain your implementation and decisions."

**Constraint added to this build:** only free-tier APIs and a free-tier database are used — no paid keys, no credit card required to run this project. This constraint is treated as a first-class design input below, not an afterthought, because it changes several decisions (notably AI provider and embeddings).

---

## 1. Overall Stack Summary

| Layer | Choice |
|---|---|
| Frontend | React (Vite) + TailwindCSS |
| Backend | Node.js + Express (or FastAPI/Python — see alternative below) |
| Database | **Neon** — free-tier serverless Postgres (via Prisma ORM) |
| AI Provider (text/classification) | **Groq API** — free tier, Llama 3.3 70B (fast, generous rate limits, JSON mode) |
| Embeddings / similarity | **Hugging Face Inference Providers API** — `feature-extraction` endpoint calling `sentence-transformers/all-MiniLM-L6-v2` (free tier, rate-limited) + cosine similarity computed server-side. No model weights downloaded or executed locally. |
| Dev/runtime | Local Node/Python process, `.env` config (Neon connection string + Groq key), single `npm run dev` command |

---

## 2. Decision: Frontend — React + Tailwind (not Next.js, not plain HTML/JS)

**Situation:** 3.5-hour time box, single evaluator running locally, UI clarity is a graded area ("UX: Clarity and usability"), and the brief explicitly asks for emojis in UI — implying a lightweight, expressive UI rather than an enterprise design system.

**Task:** Pick a frontend approach that's fast to build, easy for an evaluator to run, and lets me show incident list, incident detail, AI panel, and a create form without fighting the framework.

**Action:** Chose React + Vite over Next.js because I don't need SSR, file-based routing, or API routes bundled into the frontend — this is a small SPA talking to a separate backend. Chose Tailwind over hand-rolled CSS to move fast on layout/spacing without a design system detour, and because utility classes make "clarity and usability" easier to iterate on quickly.

**Result:** Faster iteration loop (`npm run dev` hot reload), a UI that looks intentional rather than default-browser-styled, and a codebase an evaluator can read in minutes. **Trade-off accepted:** React adds build tooling overhead vs. plain HTML/JS; justified because the grading explicitly rewards UX clarity, and React's componentization (IncidentCard, AIAnalysisPanel, KBResultsList) maps cleanly to the feature set, aiding "Engineering: design, code quality, maintainability."

---

## 3. Decision: Backend — Node/Express (with FastAPI/Python as a documented alternative)

**Situation:** Need a backend that (a) persists incidents, (b) calls an LLM API, (c) does embedding-based similarity search, all within the time box, and (d) is easy for the evaluator to run without complex setup.

**Task:** Pick a backend language/framework that minimizes boilerplate for CRUD + external API calls + a bit of numeric work (cosine similarity).

**Action:** Chose **Node + Express** as primary because it shares a language with the frontend (one mental model, one package ecosystem, faster context-switching under time pressure), and the official Anthropic/OpenAI SDKs are first-class in both JS and Python. Documented **FastAPI (Python)** as an equally valid alternative because Python's `numpy`/`scikit-learn` make cosine similarity and any lightweight data work slightly more idiomatic, and the source dataset is on Hugging Face (a Python-native ecosystem) — if the seed-data preprocessing step got heavier, Python would win.

**Result:** Node/Express keeps the whole stack in one language for a solo 3.5-hour build (lower cognitive overhead, one `npm install`), while the README explicitly notes *why* Python was the runner-up, showing the trade-off was a conscious choice, not a default.

---

## 4. Decision: Database — Neon (free-tier serverless Postgres), not SQLite, not self-hosted Postgres

**Situation:** The assessment needs "sensible data handling" and real persistence, and the build constraint is "free APIs and database only" — but a local SQLite file, while free, doesn't reflect how the app would actually be run/shared (e.g., an evaluator opening a deployed link, or two people looking at the same data), and self-hosted Postgres needs Docker/infra the evaluator would have to install.

**Task:** Choose a datastore that's genuinely persistent, relational (incidents ↔ KB articles ↔ resolutions), reachable from both local dev and a deployed instance, and costs nothing to run at this scale.

**Action:** Chose **Neon** — a serverless Postgres provider with a free tier (generous storage/compute for a small app, autosuspends when idle so it stays within free limits). Connected via Prisma using a standard `DATABASE_URL` connection string in `.env`. This gives real Postgres (proper types, indexing, JSON columns for embeddings) without installing or managing a database server locally.

**Result:** The app is backed by a production-grade relational database from day one, at zero cost, and the same connection string works whether the evaluator runs the backend locally or the app is deployed (e.g., to Render/Vercel) — one fewer thing to reconfigure between "demo on my laptop" and "share a live link." **Trade-off accepted:** requires an internet connection during dev/demo (no fully-offline mode) and a one-time signup for a free Neon project; both are minor compared to the benefit of a real, shareable, zero-cost database. Documented as a known limitation: Neon's free tier has compute/storage caps and can "cold start" after idling, which can add a brief delay to the first request after inactivity.

---

## 5. Decision: AI Provider — Groq API (free tier), via a thin provider-adapter layer

**Situation:** The brief requires AI to be a *meaningful*, non-hardcoded part of the solution, used for (a) classification/summarization of an incident, and (b) connecting incidents to relevant KB/past-ticket content — and the build constraint is free-tier-only, no paid API keys.

**Task:** Pick an LLM provider that (a) has a genuinely free tier with rate limits generous enough to demo comfortably, (b) supports structured/JSON output for reliable classification, and (c) is fast enough that "auto-analyze on incident creation" doesn't feel sluggish.

**Action:** Chose the **Groq API** (free tier) running an open-weight model such as Llama 3.3 70B — Groq's inference is unusually fast (LPU hardware), the free tier is generous for a demo's request volume, and it supports JSON-mode/structured output for reliable classification. Wrapped **all AI calls behind a single `AIProvider` interface** (`classifyIncident()`, `summarize()`) rather than calling the SDK directly from route handlers, so swapping to another free provider (e.g., Google Gemini's free tier) later is a one-file change. *(Google Gemini's free tier is documented as the fallback/alternative — also genuinely free and strong at structured output, chosen against here mainly because Groq's latency is lower for a snappier "auto-analyze" UX.)*

**Result:** Meets the "AI must be meaningful, not hardcoded rules" requirement directly — classification and summarization genuinely depend on live model output — while keeping the entire project runnable with zero spend. The adapter layer also makes the required **graceful degradation** (NFR: AI failure shouldn't block core CRUD) straightforward: the adapter catches provider errors *and* free-tier rate-limit errors (HTTP 429) and returns a `null`/`"unavailable"` state that the UI renders as "AI analysis pending — retry" instead of crashing the request. **Trade-off accepted and documented:** free-tier rate limits are real — under heavy/burst use (e.g., seeding many tickets at once) requests may need to be throttled or queued; the seed script batches/delays calls to stay within limits rather than assuming unlimited throughput.

---

## 6. Decision: Similarity Search — Hugging Face Inference Providers embeddings API + cosine similarity in-app (not a locally-run model, not a hosted vector DB)

**Situation:** FR5 requires connecting incidents to relevant KB articles/past tickets using AI (semantic, not keyword, matching). Embeddings are called *far* more often than classification (every KB article, every incident, every re-embed on edit), so this is the call pattern most likely to bump into a free-tier rate limit — and the project constraint is that **all AI inference runs online, via a free API, with no model weights downloaded or executed inside the app process.**

**Task:** Implement semantic retrieval that is genuinely AI-driven and free, without running any model locally and without introducing infrastructure (a hosted vector DB) disproportionate to a "small knowledge base."

**Action:** Call the **Hugging Face Inference Providers API** (`feature-extraction` task) against a small open sentence-embedding model, `sentence-transformers/all-MiniLM-L6-v2` — the same model family originally considered, but invoked as a hosted HTTP call rather than loaded into the Node process. This keeps the implementation consistent with the rest of the stack (thin `EmbeddingProvider` adapter, same shape as `AIProvider`) and ties naturally into the project's existing Hugging Face footprint, since the seed dataset (`mindweave/help-desk-tickets`) is also sourced from HF. Store each returned embedding vector as a column in Postgres (Neon) and compute cosine similarity in application code at query time — the KB is small enough that this is O(n) over a few hundred rows, well within interactive latency once the vector is fetched.

**Result:** Full semantic search capability (the hard part of FR5) with **zero paid cost and no local inference**, while staying inside a single coherent ecosystem story (Groq for classification, HF for embeddings, HF for the source dataset) that's easy to explain in an interview. **Trade-off accepted:** the embeddings endpoint is now a second external dependency with its own free-tier rate limit (roughly a few hundred requests/hour, shared-infrastructure cold starts of 10–30s on less-popular models) — so, like the Groq classification path, it needs its own timeout/retry and graceful-degradation handling rather than being treated as "always available." This is documented explicitly in §7 (error handling) rather than assumed away, and the seed script throttles/batches embedding calls for the same reason it throttles Groq calls (§7 of this doc). **Also documented as a known limitation:** this embedding model is smaller/less accurate than a large hosted model, and the current design doesn't scale to tens of thousands of documents on a single process — at production scale this would move to Postgres's `pgvector` extension (which Neon supports) alongside the same hosted embedding call.

---

## 7. Decision: Data Source Handling — Offline preprocessing script (not a live API call to Hugging Face at runtime)

**Situation:** The brief points to a Hugging Face dataset as the ticket data source, but the app itself is meant to be a live incident-management tool, not a dataset browser.

**Task:** Use the dataset to seed realistic KB/historical-ticket content without making the running app dependent on Hugging Face's availability.

**Action:** Wrote a one-time `scripts/seed.js` (or `seed.py`) that downloads/reads the dataset, extracts a representative subset (category, description, resolution fields), and inserts it into Neon (Postgres) as historical resolved incidents + derived KB articles, fetching each embedding from the Hugging Face Inference Providers API at seed time (see §6) and lightly throttling both the embedding calls and the Groq classification calls made during seeding to stay inside both providers' free-tier rate limits.

**Result:** The running app has zero runtime dependency on an external dataset host (more reliable demo), while still satisfying the requirement to ground the KB/history in the provided real-world data rather than fabricated examples.

---

## 8. Rejected Alternatives (brief record)

| Option | Why rejected |
|---|---|
| Next.js full-stack | Overkill for a small SPA + API; adds SSR/routing concepts not needed here |
| SQLite | Fine for pure local dev, but doesn't work well for a shareable/deployed demo; Neon gives the same zero-cost simplicity plus a real shared connection string |
| Self-hosted Postgres / Docker Compose | Setup friction for the evaluator outweighs benefit; Neon removes the infra step entirely while still being free |
| Anthropic Claude / OpenAI API as primary | Both are strong providers, but require a paid key (or very limited/expired free credits) — violates the "free APIs only" constraint; kept as a documented adapter-swap option, not the default |
| Local in-process embedding model (`@xenova/transformers` / `transformers.js`) | Would remove the rate-limit exposure, but violates the project constraint that all AI inference run via an external free API rather than shipping/running model weights inside the app — also adds a non-trivial cold-start/bundle-size cost to the server process |
| Paid hosted embeddings API (OpenAI/Cohere production tier) | Requires a paid key or a very limited trial credit — violates the "free APIs only" constraint |
| Hosted vector DB (Pinecone) | Infra/cost/setup disproportionate to a "small" KB; Postgres (`pgvector`-ready via Neon) is a lighter, free-tier-compatible path if scale ever required it |
| Fully rule-based/keyword categorization | Explicitly disallowed — brief states "do not rely entirely on hard-coded rules to simulate AI behavior" |
| LangChain/heavy agent framework | Adds abstraction overhead; a thin custom provider-adapter is more transparent and easier to explain line-by-line in an interview |
