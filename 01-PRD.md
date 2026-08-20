# Product Requirements Document (PRD)
## AI-Powered Service Desk — DigiPlus Technical Assessment

---

## 1. Overview

Support engineers currently receive technical issues as unstructured, free-text natural language ("my VPN keeps disconnecting every 10 mins on WFH"). Triage today is manual: a human reads the ticket, guesses severity, searches old tickets/docs from memory, and decides what to do. This is slow and inconsistent, especially for engineers who are new to the team or handling high ticket volume.

**Product goal:** Build a small AI-Powered Service Desk that lets a support engineer log an incident in plain language, and have the system *actively assist* — by classifying it, surfacing similar past incidents, pulling relevant knowledge base (KB) articles, and suggesting a resolution path — while the engineer stays in control of the final decision and outcome.

---

## 2. Problem Statement (restated from brief)

> Support teams receive technical issues in natural language and need to quickly understand, prioritize, and resolve them.

The system is not a chatbot that "solves" tickets autonomously. It is a **decision-support tool**: AI narrows the search space and does the reading; the human makes the call and records the resolution.

---

## 3. Target User & Persona

| Persona | Needs |
|---|---|
| **Support Engineer (primary)** | Fast triage, don't want to re-read every old ticket, wants confidence on severity/category, wants a starting point for resolution. |
| **Support Lead (secondary, optional)** | Wants visibility into volume, categories, and recurring issues (analytics). |

---

## 4. Core Functional Requirements (from brief — non-negotiable)

| # | Requirement | Notes |
|---|---|---|
| FR1 | Create and persist incidents | Free-text submission form (title + description, optionally reporter/channel) |
| FR2 | View and manage existing incidents | List view + detail view; status lifecycle (Open → In Progress → Resolved → Closed) |
| FR3 | Auto-analyze an incident using AI | On creation, AI extracts category, priority/severity, and a summary |
| FR4 | Maintain a small knowledge base (KB) | Seeded from the provided Hugging Face ticket dataset + a handful of resolution articles |
| FR5 | AI connects incidents to relevant support info | Semantic search over KB + past resolved tickets (RAG-style retrieval) |
| FR6 | Record outcome/resolution | Free-text resolution notes, resolution category, close ticket |
| FR7 | Validation & error handling | Required fields, AI-call failure fallback (graceful degradation, not a crash) |

## 5. User Stories

1. **As a support engineer**, I want to type a new issue in plain English and have it saved immediately, so I don't lose the report while it's being analyzed.
2. **As a support engineer**, I want the system to auto-suggest a category and priority, so I don't have to manually triage from scratch.
3. **As a support engineer**, I want to see similar past incidents and their resolutions (with a similarity %), so I can reuse a known fix and spot likely duplicates.
4. **As a support engineer**, I want to search the incident list by words (title/description/notes), without waiting on AI, so I can find a ticket quickly.
5. **As a support engineer**, I want to see relevant KB articles ranked by relevance, not keyword match, so I find the right doc even if my wording differs.
6. **As a support engineer**, I want to record what I actually did to resolve the issue and return to the list, so future engineers benefit from it.
7. **As a support engineer**, I want the app to still work (in a degraded form) if Groq or Hugging Face is down or rate-limited, so I'm not blocked from logging tickets.
8. **(Optional) As a support lead**, I want a dashboard of ticket volume by category/priority, so I can spot trends.

## 6. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Reliability | AI failure — from either the classification/summary provider or the embeddings provider — must not block core CRUD (create/view/resolve incident) |
| Latency | AI analysis should feel "near real-time" (<5s) or be async with a visible loading/pending state |
| Data integrity | Every AI-derived field (category, priority, similar tickets) is **editable/overridable** by the human — AI suggests, doesn't dictate |
| Explainability | AI output should show *why* — e.g., which KB article or which similar ticket informed the suggestion |
| Cost/scope | Small assessment app — favor a single AI provider, no over-engineered microservices |
| Auditability | Store the raw AI response used for a decision (for traceability / debugging) |

## 7. Optional Enhancements (chosen for this build)

Given 3.5 hours, priority order (highest ROI for lowest time cost first):

1. **Similar/duplicate incident detection** (embeddings + cosine similarity) — directly required by FR5, cheap to extend.
2. **Automatic categorization** — already required by FR3, extend to a fixed taxonomy.
3. **Basic analytics** (ticket count by category/priority/status) — cheap, high visual payoff for a demo.
4. Deferred (documented as "known limitation / future work" instead of built): auth, notifications, containerization, full conversational AI chat interface.

*Rationale for cutting auth/notifications/containerization: the assessment explicitly says these are optional and the time budget (3.5h) does not support building all of them at demo quality. Documenting the cut is safer than a half-built feature.*

## 8. Out of Scope

- Multi-tenant / multi-org support
- Role-based access control
- Real-time collaboration (multiple engineers editing same ticket)
- SLA timers / escalation workflows
- Production-grade authentication (SSO, OAuth) — a single-user or mock-login model is sufficient

## 9. Success Metrics (for the demo/assessment)

- Every core requirement (FR1–FR7) is demonstrably working end-to-end.
- AI involvement is *load-bearing*, not decorative (i.e., removing the AI call would visibly break FR3/FR5, not just remove a nice-to-have label).
- App survives an AI-provider failure without crashing (graceful fallback demoed).
- README lets a fresh evaluator run the app in under 5 minutes.

## 10. Assumptions

- The Hugging Face dataset (`mindweave/help-desk-tickets`) is used **offline**, pre-processed into a seed script — not fetched live at runtime.
- A single support engineer persona is sufficient (no multi-user auth needed for the assessment).
- "AI-assisted information" means retrieval + suggestion, not autonomous ticket resolution — the human always closes the loop.
- Evaluators run the UI/API locally; **MongoDB Atlas**, Groq, and Hugging Face are reached over the internet.
- Groq model is **`openai/gpt-oss-120b`** (override with `GROQ_MODEL` if needed).

## 11. Known Limitations (to state upfront, not hide)

- No authentication — anyone with the URL can create/view/resolve tickets.
- KB is small/seeded, not continuously curated.
- Similarity search is embedding-based cosine similarity over MongoDB documents, not a production vector DB (acceptable at this scale).
- Classification uses Groq (`openai/gpt-oss-120b`); embeddings use Hugging Face Inference Providers (`all-MiniLM-L6-v2`). Both are free-tier HTTP APIs (rate limits, cold starts). Failures degrade to retry UI; they must not block CRUD.
- Persistence is **MongoDB Atlas** (collections `incidents` and `kb_articles`), reached over the internet — not local Mongo and not Postgres/Neon.
- List search is **client-side keyword matching** (no AI); similar-ticket ranking is embedding cosine similarity (AI).
- No SLA/escalation logic.
- AI suggestions can be wrong; the UI must make override trivial rather than trying to make AI "always right."
