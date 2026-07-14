# SmartSupport build log

One entry per phase: what was built, what it was verified against, and decisions worth knowing.
"Verified" means an actual command was run in-session and its output checked — not "the code looks right."

## Phase 0 — Scaffolding (in progress: code done, verification blocked on credentials)

**Built:**
- Express 5 API skeleton (`server/`): `/api/health`, CORS+JSON middleware, fail-fast boot when
  `MONGODB_URI` / `GEMINI_API_KEY` / `PINECONE_API_KEY` are missing.
- Shared infra modules: `config.js` (env loading), `db.js` (Mongoose), `lib/gemini.js`
  (generateText + embedText), `lib/pinecone.js` (client + `kb-articles` / `closed-tickets` namespaces).
- `scripts/ping.js`: pings MongoDB, Gemini generation, Gemini embeddings, and Pinecone; prints
  PASS/FAIL per service; exit code 0 only when all pass.
- Vite + React 19 + Tailwind 4 client with placeholder routes `/` (submit) and `/agent` (dashboard),
  dev proxy `/api` → `localhost:5001`.

**Verified:**
- `npm run ping` runs and correctly reports FAIL with "missing credential" for all three services
  (no credentials in the environment yet).
- Client production build passes (`npm run build` in `client/`).
- Server boot fails fast with a clear message when env vars are absent.

**Blocked:**
- Need `MONGODB_URI`, `GEMINI_API_KEY`, `PINECONE_API_KEY` (and optionally a Pinecone index name —
  defaults to `smartsupport`) before the ping can pass and Phase 1 can start.
- Git push to `claude/sleepy-bohr-wydx06` is denied: the session's git token returns
  403 "Permission to SreeAdithya123/mernstack_project.git denied to SreeAdithya123" (fetch works,
  so read access is fine), and the GitHub API integration likewise returns 403 "Resource not
  accessible by integration". The Claude GitHub App needs write (Contents) permission on this repo.
  Phase 0 is committed locally (`ccf9b22`) and will be pushed as soon as write access is granted.

**Decisions:**
- API port defaults to **5001** (5000 collides with AirPlay on macOS). Configurable via `PORT`.
- Embeddings: `gemini-embedding-001` truncated to **768 dims** (cheap, plenty for this corpus);
  Pinecone index will be created serverless / aws us-east-1 / cosine / dim 768 by the Phase 1 seed
  script if it doesn't already exist. Overridable via `EMBED_DIMENSION`, `PINECONE_INDEX`.
- One Pinecone index with two namespaces (`kb-articles`, `closed-tickets`) rather than two indexes —
  satisfies the "keep them separate" contract without doubling index management.
- Express 5 (current npm default): async route handlers forward rejections to the error middleware
  automatically, so no wrapper helpers are needed.
- Node 22's built-in `--watch` instead of nodemon; Tailwind 4 via the `@tailwindcss/vite` plugin
  (no PostCSS config needed).
