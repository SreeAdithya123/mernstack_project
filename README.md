# SmartSupport

Intelligent customer service triage & resolution hub. A ticket comes in, Gemini classifies it
(sentiment / priority / category), Pinecone retrieves grounding context from a knowledge base and
from past resolved tickets, Gemini drafts a reply, and a human agent reviews and sends it.

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS (`client/`)
- **Backend:** Node.js + Express 5 (`server/`)
- **Database:** MongoDB Atlas (tickets, KB articles)
- **Vector DB:** Pinecone — one index, two namespaces (`kb-articles`, `closed-tickets`)
- **AI:** Google Gemini via AI Studio (`gemini-2.5-flash` for classification/RAG, `gemini-embedding-001` at 768 dims for embeddings)

## Setup

1. `npm run install:all`
2. `cp server/.env.example server/.env` and fill in `MONGODB_URI`, `GEMINI_API_KEY`, `PINECONE_API_KEY`
   (see the comments in that file for where each key comes from).
3. `npm run ping` — verifies MongoDB, Gemini, and Pinecone all authenticate. Fix any FAIL before moving on.
4. `npm run dev` — starts the API on http://localhost:5001 and the client on http://localhost:5173.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs server (`:5001`) and client (`:5173`) together |
| `npm run ping` | Connectivity check for MongoDB, Gemini, Pinecone |
| `npm run install:all` | Installs root, server, and client dependencies |

## Repo layout

```
server/
  src/index.js        Express bootstrap (fails fast if env vars are missing)
  src/config.js       Env loading (server/.env, then repo-root .env)
  src/db.js           Mongoose connection
  src/lib/gemini.js   Gemini client: generateText, embedText
  src/lib/pinecone.js Pinecone client + namespace constants
  scripts/ping.js     Phase 0 connectivity verification
client/
  src/                Vite + React app: "/" submit form, "/agent" dashboard
```

## Build status

See `BUILD_LOG.md` for the phase-by-phase log of what is built and what has actually been
verified against live services.
