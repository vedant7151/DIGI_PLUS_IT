# Tech Stack Decisions
## AI-Powered Service Desk — DigiPlus Technical Assessment

Every decision below is framed with **STAR** (Situation, Task, Action, Result) so it can be explained/defended in an interview — this is what an interviewer is really testing when they say "explain your implementation and decisions."

**Constraint added to this build:** only free-tier APIs and a free-tier database are used — no paid keys, no credit card required to run this project. This constraint is treated as a first-class design input below, not an afterthought, because it changes several decisions (notably AI provider and embeddings).

---

## 1. Overall Stack Summary

| Layer | Choice |
|---|---|
| Frontend | React (Vite) + TailwindCSS + React Router |
| Backend | Node.js + Express (TypeScript) |
| Database | **MongoDB Atlas** (free tier) via the official `mongodb` driver — collections `incidents` and `kb_articles`. No Prisma, no Postgres/Neon. |
| AI Provider (text/classification) | **Groq API** — free tier, model **`openai/gpt-oss-120b`**, JSON mode (`classifyIncident` / `summarize`) |
| Embeddings / similarity | **Hugging Face Inference Providers API** — `feature-extraction` on `sentence-transformers/all-MiniLM-L6-v2` over HTTPS + cosine similarity in application code. No local model weights. |
| List search | Frontend keyword filter only (no AI, no extra API) |
| Dev/runtime | Two processes (`backend/` and `frontend/` each `npm run dev`); `.env` holds `MONGODB_URI`, `GROQ_API_KEY`, `HF_API_KEY` |

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

## 4. Decision: Database — MongoDB Atlas (official driver), not Neon/Postgres, not Prisma, not SQLite

**Situation:** The assessment needs real persistence that an evaluator can share, with a free tier and no local database server. An earlier Neon (Postgres) + Prisma path failed repeatedly from this network (connection resets / unreachable pooler). A later local in-process Mongo fallback was dropped once internet access to Atlas was reliable.

**Task:** Persist incidents and KB articles (including embedding vectors and raw AI JSON) with a hosted free-tier database and a thin Node client.

**Action:** Chose **MongoDB Atlas** (M0 free cluster) and the official **`mongodb` Node driver**. Documents map 1:1 to the design model (`incidents`, `kb_articles`); embeddings and `aiRawResponse` are stored as native JSON arrays/objects. Connection string is `MONGODB_URI` in `backend/.env`. There is **no Prisma**, **no SQL schema**, and **no local MongoDB fallback**.

**Result:** One connection string works for local demo and a deployed API; documents are a natural fit for nullable AI fields and vectors. **Trade-off accepted:** Atlas requires internet and Network Access (IP allowlist). Documented limitation: free-tier Atlas is not a vector database — cosine similarity still runs in the Node process over a small collection.

---

## 5. Decision: AI Provider — Groq API (free tier), model `openai/gpt-oss-120b`

**Situation:** The brief requires AI to be a *meaningful*, non-hardcoded part of the solution for classification/summarization, using only a free-tier provider.

**Task:** Pick an LLM that supports structured JSON, is fast enough for auto-analyze, and stays on Groq's free tier.

**Action:** Chose the **Groq API** (OpenAI-compatible `https://api.groq.com/openai/v1/chat/completions`) running **`openai/gpt-oss-120b`** (overridable via `GROQ_MODEL`). Groq's LPU inference is fast; JSON mode is used for `{ category, priority, summary }`. All calls go through `AIProvider.classifyIncident()` / `summarize()` so Groq is not invoked from route handlers. Classification is **persisted independently** of embeddings so a slow HF call cannot hide Groq results in the UI.

**Result:** Live Groq output drives category, priority, and summary. 429/timeouts return `null` fields and a Retry control — never a 500. **Trade-off accepted:** free-tier rate limits; the seed script throttles Groq calls.

---

## 6. Decision: Similarity Search — Hugging Face Inference Providers embeddings API + cosine similarity in-app (not a locally-run model, not a hosted vector DB)

**Situation:** FR5 requires connecting incidents to relevant KB articles/past tickets using AI (semantic, not keyword, matching). Embeddings are called *far* more often than classification (every KB article, every incident, every re-embed on edit), so this is the call pattern most likely to bump into a free-tier rate limit — and the project constraint is that **all AI inference runs online, via a free API, with no model weights downloaded or executed inside the app process.**

**Task:** Implement semantic retrieval that is genuinely AI-driven and free, without running any model locally and without introducing infrastructure (a hosted vector DB) disproportionate to a "small knowledge base."

**Action:** Call the **Hugging Face Inference Providers API** (`feature-extraction` task) against `sentence-transformers/all-MiniLM-L6-v2` over HTTPS (thin `EmbeddingProvider` adapter). Store each vector as an array on the MongoDB document and compute cosine similarity in application code at query time. Similar incidents are scored only against **resolved/closed** tickets; a high score is a **hint** (possible duplicate), not an auto-merge. List-page search is **not** this path — it is a frontend keyword filter.

**Result:** Semantic retrieval for FR5 with zero paid cost and no local inference. Groq + HF + HF dataset is one ecosystem story. **Trade-off accepted:** embeddings have their own 429/cold-start profile; they persist independently of Groq so one failure does not wipe the other. At production scale this would move to a vector index (e.g. Atlas Vector Search) with the same hosted embedding call.

---

## 7. Decision: Data Source Handling — Offline preprocessing script (not a live API call to Hugging Face at runtime)

**Situation:** The brief points to a Hugging Face dataset as the ticket data source, but the app itself is meant to be a live incident-management tool, not a dataset browser.

**Task:** Use the dataset to seed realistic KB/historical-ticket content without making the running app dependent on Hugging Face's availability.

**Action:** Wrote `backend/scripts/seed.ts` that reads a **cached CSV export** of the dataset under `backend/data/` (so seed does not depend on Hugging Face Hub being up), inserts historical resolved incidents + derived KB articles into **MongoDB Atlas**, fetches embeddings from HF Inference Providers at seed time, and throttles Groq/HF to stay inside free-tier limits. Seeded incidents use dataset labels rather than live Groq classification.

**Result:** The running app has zero runtime dependency on an external dataset host (more reliable demo), while still satisfying the requirement to ground the KB/history in the provided real-world data rather than fabricated examples.

---

## 8. Rejected Alternatives (brief record)

| Option | Why rejected |
|---|---|
| Next.js full-stack | Overkill for a small SPA + API; adds SSR/routing concepts not needed here |
| Neon + Prisma (Postgres) | Attempted first; this network could not reach Neon's pooler reliably. MongoDB Atlas + native driver replaced it. |
| SQLite | Fine for pure local files, but not a shared cloud demo. |
| Local MongoDB / `mongodb-memory-server` | Useful as a temporary offline fallback; removed so the demo always uses Atlas over the internet. |
| Self-hosted Postgres / Docker Compose | Extra evaluator setup; Atlas is free-tier hosted persistence without Docker. |
| Anthropic Claude / OpenAI API as primary | Both are strong providers, but require a paid key (or very limited/expired free credits) — violates the "free APIs only" constraint; kept as a documented adapter-swap option, not the default |
| Local in-process embedding model (`@xenova/transformers` / `transformers.js`) | Would remove the rate-limit exposure, but violates the project constraint that all AI inference run via an external free API rather than shipping/running model weights inside the app — also adds a non-trivial cold-start/bundle-size cost to the server process |
| Paid hosted embeddings API (OpenAI/Cohere production tier) | Requires a paid key or a very limited trial credit — violates the "free APIs only" constraint |
| Hosted vector DB (Pinecone) | Disproportionate to a small KB; in-app cosine over Atlas documents is enough; Atlas Vector Search would be the later path |
| Fully rule-based/keyword categorization | Explicitly disallowed — brief states "do not rely entirely on hard-coded rules to simulate AI behavior" |
| LangChain/heavy agent framework | Adds abstraction overhead; a thin custom provider-adapter is more transparent and easier to explain line-by-line in an interview |
