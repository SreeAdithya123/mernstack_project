# SmartSupport

Intelligent customer service triage & resolution hub. A ticket comes in, an LLM classifies it
(sentiment / priority / category), Pinecone retrieves grounding context from a knowledge base and
from past resolved tickets, the LLM drafts a reply, and a human agent reviews and sends it.

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS (`client/`)
- **Backend:** Node.js + Express 5 (`server/`)
- **Database:** MongoDB (Atlas in production; any MongoDB-compatible server via `MONGODB_URI`)
- **Vector DB:** Pinecone — one index, two namespaces (`kb-articles`, `closed-tickets`)
- **LLM:** OpenRouter (`google/gemma-4-31b-it:free`) for classification, reply drafting, summarization
- **Embeddings:** Pinecone Inference (`llama-text-embed-v2`, 1024 dims) — OpenRouter has no
  embeddings endpoint, so vectors come from Pinecone's hosted embedding model

## Setup

1. `npm run install:all`
2. `cp server/.env.example server/.env` and fill in `MONGODB_URI`, `OPENROUTER_API_KEY`,
   `PINECONE_API_KEY` (see the comments in that file for where each key comes from).
3. `npm run ping` — verifies MongoDB, OpenRouter, and Pinecone all authenticate. Fix any FAIL
   before moving on.
4. `npm run dev` — starts the API on http://localhost:5001 and the client on http://localhost:5173.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs server (`:5001`) and client (`:5173`) together |
| `npm run ping` | Connectivity check for MongoDB, OpenRouter, Pinecone |
| `npm run db:local` | Starts a local MongoDB-compatible dev DB (FerretDB + SQLite) on `:27017` |
| `npm run install:all` | Installs root, server, and client dependencies |

`db:local` exists for sandboxed dev environments where MongoDB Atlas is unreachable (it needs a
`ferretdb` binary on PATH). On your own machine, skip it and point `MONGODB_URI` at Atlas.

## Repo layout

```
server/
  src/index.js            Express bootstrap (fails fast if env vars are missing)
  src/config.js           Env loading (server/.env, then repo-root .env)
  src/db.js               Mongoose connection
  src/lib/llm.js          OpenRouter chat completions: chat, generateText
  src/lib/embeddings.js   Pinecone Inference embeddings: embedPassages, embedQuery
  src/lib/pinecone.js     Pinecone client + namespace constants
  scripts/ping.js         Phase 0 connectivity verification
client/
  src/                    Vite + React app: "/" submit form, "/agent" dashboard
```

## Build status

See `BUILD_LOG.md` for the phase-by-phase log of what is built and what has actually been
verified against live services.
