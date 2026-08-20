# AI-Powered Service Desk

Support engineers log incidents in plain language. The system classifies them (Groq), finds similar past tickets and KB articles (Hugging Face embeddings + cosine similarity), and the engineer stays in control of category, priority, and resolution.

## Prerequisites

- Node.js 20+ and npm
- A **Groq** free-tier API key: https://console.groq.com
- A **Hugging Face** token with Inference Providers access: https://huggingface.co/settings/tokens
- **MongoDB Atlas** — cloud cluster accessed over the internet (`MONGODB_URI`)

## Setup and run

### 1. Clone

```bash
git clone https://github.com/vedant7151/DIGI_PLUS_IT.git
cd DIGI_PLUS_IT
```

### 2. Backend environment

Copy the example file and fill in keys (never commit `.env`):

**PowerShell**

```powershell
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

**macOS / Linux**

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env`:

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net
GROQ_API_KEY=gsk_...
HF_API_KEY=hf_...
PORT=3001
```

`MONGODB_URI` is required. The backend talks only to Atlas over the internet (no local Mongo fallback).

Edit `frontend/.env`:

```
VITE_API_URL=http://localhost:3001
```

### 3. Install and start the API

```powershell
cd backend
npm install
npm run seed
npm run dev
```

API: http://localhost:3001  
Health check: http://localhost:3001/health

`npm run seed` is optional. It loads a cached export of [`mindweave/help-desk-tickets`](https://huggingface.co/datasets/mindweave/help-desk-tickets) from `backend/data/` and inserts historical incidents + KB articles (Groq/HF calls are throttled). Skip it if you only want empty tickets.

Leave this terminal running.

### 4. Start the UI (second terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### 5. Use the app

1. **New** — create a ticket (saved immediately; AI runs after).
2. **Incident detail** — edit category/priority/summary, retry classification or similarity (toasts on those buttons), record a resolution.
3. **Analytics** — ticket counts by category, priority, and status.

## Approach

- **Persist first, analyze second.** Creating a ticket returns immediately (`status=open`). Groq classification and HF embeddings run afterward and can fail independently without a 500.
- **Thin adapters.** `AIProvider` (Groq) and `EmbeddingProvider` (HF HTTP feature-extraction) never run models in-process. Retrieval is cosine similarity in application code over stored vectors.
- **AI suggests, humans decide.** Category and priority are always editable dropdowns, with an “🤖 AI Suggested” badge.
- **MongoDB Atlas** for persistence (`incidents`, `kb_articles`), reached over the internet.
- **Hugging Face Inference Providers** for embeddings (`sentence-transformers/all-MiniLM-L6-v2` over HTTPS). No model is downloaded or run locally.

## Known limitations

- No authentication — anyone with the URL can create/view/resolve tickets.
- KB is small/seeded, not continuously curated.
- Similarity is in-app cosine similarity, not a production vector database.
- Embeddings and classification both go through free-tier APIs (rate limits, cold starts). Failures degrade to retry UI; they must not block CRUD.
- The embedding model (MiniLM) is smaller than large hosted embedders; this scale is a few hundred documents, not tens of thousands.
- Groq/HF free-tier quotas require the seed script to throttle rather than burst.

## API (backend)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB ping |
| POST | `/api/incidents` | Create (AI async) |
| GET | `/api/incidents` | `?status=&category=&priority=` |
| GET | `/api/incidents/:id` | Detail + similar + KB |
| PATCH | `/api/incidents/:id` | Update / resolve |
| POST | `/api/incidents/:id/retry-classification` | Groq only |
| POST | `/api/incidents/:id/retry-similarity` | HF embeddings + retrieval |
| GET | `/api/kb` | KB list |
| GET | `/api/analytics` | Counts by category / priority / status |
