# SmartSupport build log

One entry per phase: what was built, what it was verified against, and decisions worth knowing.
"Verified" means an actual command was run in-session and its output checked — not "the code looks right."

## Phase 0 — Scaffolding (code done; verification 1/3 services, blocked on network allowlist)

**Built:**
- Express 5 API skeleton (`server/`): `/api/health`, CORS+JSON middleware, fail-fast boot when
  required env vars are missing.
- Shared infra modules: `config.js` (env loading), `db.js` (Mongoose), `lib/llm.js` (OpenRouter
  chat completions), `lib/embeddings.js` (Pinecone Inference, passage/query input types),
  `lib/pinecone.js` (client + `kb-articles` / `closed-tickets` namespaces).
- `scripts/ping.js`: pings MongoDB, OpenRouter, Pinecone inference, and Pinecone control plane;
  prints PASS/FAIL per service; exit 0 only when all pass.
- Vite + React 19 + Tailwind 4 client with placeholder routes `/` (submit) and `/agent`
  (dashboard), dev proxy `/api` → `localhost:5001`.
- Local dev database: FerretDB v1.24.2 (MongoDB wire protocol over SQLite), built from source via
  the Go module proxy because Atlas is unreachable from this sandbox (see network findings).
  Started with `npm run db:local`.

**Verified (2026-07-14):**
- `npm run ping` output: `PASS MongoDB (connected, ping ok)` / `FAIL OpenRouter LLM (Host not in
  allowlist: openrouter.ai)` / `FAIL Pinecone embeddings + index (Host not in allowlist:
  api.pinecone.io)`. The two FAILs are environment egress policy, not code or credentials.
- Mongoose CRUD against FerretDB: insertMany, countDocuments, find+sort, updateOne, createIndex,
  drop — all passed in a live probe.
- Client production build passes (`vite build`).
- Server fails fast with a clear message when env vars are absent.

**Stack change (user-directed, 2026-07-14):** the user supplied an OpenRouter key
(`google/gemma-4-31b-it:free`) instead of a Google AI Studio Gemini key. Consequences:
- Classification / drafting / summarization: OpenRouter chat completions (plain `fetch`, no SDK).
- Embeddings: OpenRouter has **no embeddings endpoint**, so embeddings use **Pinecone Inference**
  (`llama-text-embed-v2`, 1024 dims, `inputType` passage/query). Index dimension is therefore
  **1024**, not 768. `@google/genai` dependency removed.
- Gemma free tier has strict JSON-mode limitations; Phase 2 will use prompt-engineered JSON with
  defensive parsing instead of native structured output.
- Free-tier OpenRouter rate limits (~20 req/min, low daily cap) mean verification runs are kept
  frugal.

**Network findings (Claude cloud sandbox):**
- Egress allowlist blocks `openrouter.ai` and `api.pinecone.io` ("Host not in allowlist" from the
  policy proxy). **User action needed:** allow `openrouter.ai`, `api.pinecone.io`, and
  `*.pinecone.io` (data plane) in the environment's network settings.
- Raw TCP egress (Atlas port 27017) is silently dropped — DNS SRV resolves, TLS connect times out.
  MongoDB Atlas is therefore unreachable from inside this sandbox regardless of allowlist; local
  FerretDB stands in. The code path is identical (`MONGODB_URI`), and the user's Atlas URI is kept
  in `server/.env` comments for running on their own machine.
- GitHub push denied: git proxy returns 403 ("Permission … denied to SreeAdithya123", fetch works)
  and the GitHub API integration returns 403 "Resource not accessible by integration". **User
  action needed:** grant the Claude GitHub App write (Contents) access to this repo. Work is
  committed locally and backed up as a tarball in chat meanwhile.

**Decisions:**
- API port defaults to **5001** (5000 collides with AirPlay on macOS). Configurable via `PORT`.
- One Pinecone index, two namespaces (`kb-articles`, `closed-tickets`) — satisfies the "keep them
  separate" contract without doubling index management. Index will be created serverless / aws
  us-east-1 / cosine / **dim 1024** by the Phase 1 seed script if absent.
- Express 5 (async handlers forward rejections to error middleware automatically), Node 22
  built-in `--watch`, Tailwind 4 via `@tailwindcss/vite`.
