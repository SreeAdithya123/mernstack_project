# SmartSupport build log

One entry per phase: what was built, what it was verified against, and decisions worth knowing.
"Verified" means an actual command was run in-session and its output checked — not "the code looks right."

**Standing blocker (env, not code):** this sandbox's egress allowlist blocks `api.pinecone.io` /
`*.pinecone.io`, so every Pinecone-side verification below is queued. Unblocking is a settings
change in the Claude Code environment (allow `openrouter.ai`, `api.pinecone.io`, `*.pinecone.io`).
When it lands, run in order: `npm run ping` → `node server/scripts/seedKB.js` →
`node server/scripts/seedClosedTickets.js` → `node server/scripts/searchKB.js "I can't log in"` →
re-verify Features 2–4 through the dashboard.

## Phase 0 — Scaffolding (done; ping 2/4 PASS, both FAILs are the Pinecone egress block)

**Built:** Express 5 skeleton (`/api/health`, fail-fast env validation), config/db modules,
`lib/llm.js` (dual-provider LLM), `lib/embeddings.js` (Pinecone Inference, passage/query),
`lib/pinecone.js` (client, namespaces, `ensureIndex`), `scripts/ping.js`, Vite+React 19+Tailwind 4
client, FerretDB v1.24.2 local dev DB (`npm run db:local`).

**Verified (2026-07-14):** ping prints `PASS MongoDB`, `PASS LLM (gemini/gemma-4-31b-it replied)`,
`FAIL Pinecone embeddings/index (Host not in allowlist)`. Mongoose CRUD probe against FerretDB
passed. Client `vite build` passes.

**LLM provider decisions (user-directed):**
- User supplied an OpenRouter key (`google/gemma-4-31b-it:free`) plus a Google AI Studio key as
  backup ("switch to gemini when openrouter quota is done"). Implemented as automatic failover in
  `lib/llm.js`: OpenRouter first, ANY OpenRouter failure falls back to Gemini API. Verified live —
  OpenRouter is egress-blocked here, and the fallback answered every call this session.
- Gemini fallback model: `gemma-4-31b-it` (same model family the user picked on OpenRouter).
  Chosen empirically: `gemini-3.5-flash` / `gemini-flash-latest` returned 503 "high demand",
  `gemini-2.0-flash` returned 429 quota, `gemma-4-31b-it` answered. One retry with backoff on
  503/429 is built in. Swap via `GEMINI_MODEL` env when flash quota normalizes.
- Embeddings: OpenRouter has no embeddings endpoint → Pinecone Inference `llama-text-embed-v2`
  (1024 dims). Index dimension is therefore **1024**.
- Gemma-4 emits visible reasoning around answers. Every structured task therefore asks for a
  single JSON envelope and `chatJson()` extracts the **last balanced `{...}` containing the
  required keys**, with one corrective retry. This fixed real failures: 3/4 classifications failed
  with naive first-to-last-brace parsing; 4/4 passed after.

**Network findings:** Atlas raw TCP (27017) is silently dropped by the sandbox → local FerretDB
stands in (`MONGODB_URI` unchanged as interface; user's Atlas URI in `server/.env` comments for
their own machine). GitHub push denied (git proxy 403 + API "Resource not accessible by
integration") → Claude GitHub App needs write access; work is committed locally and tarball
backups posted in chat.

## Phase 1 — Data layer & KB seed (Mongo verified; Pinecone queued)

**Built:** `Ticket` and `KBArticle` models per the data contracts (plus `summary` and
`resolutionSummary` fields used by Phases 5–6). `scripts/seedKB.js`: 12 real articles (password
reset, account access/2FA, payment failures, double charges, refund policy, subscription changes,
invoices/VAT, shipping, tracking, performance troubleshooting, display issues, feature-request
process), idempotent, Mongo-first then Pinecone mirror with `{mongoId, title, category}` metadata
and count-match check. `scripts/searchKB.js` for the manual top-3 query.

**Verified:** seed run output "MongoDB: seeded 12 KB articles", count re-checked = 12, sample
article body intact. Pinecone mirror + "I can't log in" top-3 check: **queued on egress block**
(script fails at the Pinecone step with the real error, by design).

## Phase 2 — Auto-triage & sentiment (verified live)

**Built:** `lib/triage.js` (`classifyTicket` → strict contract via `chatJson`, enum-normalized),
`POST /api/tickets` (validates input, persists ticket even if classification fails and says so),
plus list/get/add-message/patch-status routes.

**Verified:** 4 hand-written tickets through the running API:
angry double-charge → **Angry/High/Billing**; friendly dark-mode ask → **Positive/Low/Feature
Request**; team-wide 500s before a deadline → **Negative/High/Technical** (correctly not "Angry");
calm pricing question → **Neutral/Low/Billing**. Post-refactor regression check passed
(Neutral/Low/Billing for an invoice-name request). All sane, not just schema-valid.

## Phase 3 — Semantic KB search (built; verification queued on Pinecone)

**Built:** `GET /api/tickets/:id/kb-matches` — embeds subject + first user message
(`inputType: query`), top-3 from `kb-articles` namespace, resolved to full Mongo articles.
**Verified so far:** endpoint fails gracefully with the real egress error and the server stays
healthy. Topical-relevance verification queued.

## Phase 4 — RAG-drafted response (built; verification queued on Pinecone)

**Built:** `lib/draft.js` + `POST /api/tickets/:id/draft` — grounds a ≤180-word reply in the top-3
retrieved articles, forbids invented policy facts, returns `{draft, sources}`; UI drops the draft
into the reply box for the agent to edit. Draft-quality verification (references specifics from
retrieved articles) queued.

## Phase 5 — Similar issue detection (built; verification queued on Pinecone)

**Built:** `scripts/seedClosedTickets.js` — 8 realistic resolved tickets (2FA lockout, black
screen, stuck parcel, duplicate charge, VAT invoice, annual-plan refund, websocket-blocking
extension, unregistered reset email), Mongo + `closed-tickets` namespace with
`{mongoId, subject, resolutionSummary}` metadata; embedded passage = problem text + resolution.
`GET /api/tickets/:id/similar` returns matches ≥ threshold (0.80 start, `SIMILARITY_THRESHOLD`
env) plus `bestScore`, and logs scores for tuning. Resolving a ticket with a resolution summary
auto-indexes it into the namespace (failure logged as `indexWarning`, resolve still succeeds).

**Verified:** Mongo side seeded (8 tickets, visible in dashboard). Paraphrase-match /
no-false-match verification and threshold tuning queued.

## Phase 6 — Summarization & handoff notes (verified live)

**Built:** `lib/summarize.js` + `POST /api/tickets/:id/summarize`; summary stored on the ticket.

**Verified:** 6-message double-charge thread (built through the API) summarized into 3 clean
sentences that capture the CURRENT state — refund initiated with reference RF-88213, pending
customer confirmation, close-in-7-days intent — not just the opening message. Also re-verified
through the dashboard UI on a different ticket. Prompts instruct they/them pronouns unless stated
(first run assumed gender from a name).

## Phase 7 — Frontend (built; verified except Pinecone-dependent cards)

**Built:** `/` submission form (confirmation shows live triage chips) and `/agent` dashboard —
ticket list with status/priority/sentiment/category chips, thread view, reply box with "Send
reply", status select with resolution-summary capture on Resolve, and the solver panel wiring
Features 2–5 (handoff summary, suggested KB articles, similar past tickets, AI draft into the
reply box). Plain Tailwind, no component libraries.

**Verified (Playwright against the real running app):** form submit → live classification
(login-loop ticket → Negative/High/Technical) → confirmation chips rendered; dashboard lists the
ticket; thread renders; summary generated through the UI and is accurate; KB/similar cards
surface the real backend error state. Screenshots posted in chat. Full solver verification
(KB matches, similar tickets, draft) queued on Pinecone.

## Phase 8 — End-to-end verification (pending)

Blocked on the Pinecone allowlist; will re-run every verification above in one sitting once open,
log the actual similarity scores seen, and adjust the 0.80 threshold if needed.
