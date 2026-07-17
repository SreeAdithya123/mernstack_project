# SmartSupport build log

One entry per phase: what was built, what it was verified against, and decisions worth knowing.
"Verified" means an actual command was run in-session and its output checked — not "the code looks right."

**Standing blocker (env, not code):** this sandbox's egress allowlist blocks `api.pinecone.io` /
`*.pinecone.io`, so every Pinecone-side verification below is queued. Unblocking is a settings
change in the Claude Code environment (allow `openrouter.ai`, `api.pinecone.io`, `*.pinecone.io`).
When it lands, run in order: `npm run ping` → `node server/scripts/seedKB.js` →
`node server/scripts/seedClosedTickets.js` → `node server/scripts/searchKB.js "I can't log in"` →
re-verify Features 2–4 through the dashboard.

**GitHub push (resolved 2026-07-14):** was blocked all day with "GitHub access is not enabled for
this session. An org admin must connect the Claude GitHub App for this organization" — confirmed
via git push, the GitHub MCP tool, `gh` CLI, and a direct curl to `api.github.com` with a
user-supplied PAT (all four hit the identical proxy-level block, proving no credential could fix
it). User reinstalled/reconnected the Claude GitHub App via github.com/apps/claude. First push
succeeded immediately after: all 5 commits (`406000a`..`76ecfa1`) landed on
`claude/sleepy-bohr-wydx06`, remote branch head verified to match local exactly. Not an issue with
this repo or account — GitHub-side permissions were fine throughout (`gh api .../repos` briefly
showed stale `permissions.push:false` from an unrelated cached token; the actual push is the
authoritative check and it succeeded).

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

## Phase 8 — End-to-end verification (done; verified live, local machine)

**Context:** the cloud sandbox's egress allowlist blocked `api.pinecone.io` for the entire prior
session. Continuing on the user's own Windows machine removes that constraint — no code changes
were needed, only real credentials in `server/.env` (gitignored, not committed).

**Verified (2026-07-14):**
- `npm run ping`: all 4 checks PASS — MongoDB (Atlas), LLM (OpenRouter hit its free daily rate
  limit; automatic Gemini fallback answered), Pinecone embeddings (1024-dim vector), Pinecone index
  (authenticated, index "smartsupport" exists, dim 1024, cosine).
- `node server/scripts/seedKB.js`: 12 articles, Mongo count == Pinecone `kb-articles` namespace
  count (12 == 12).
- `node server/scripts/seedClosedTickets.js`: 8 tickets, Mongo count == Pinecone `closed-tickets`
  namespace count (8 == 8).
- `node server/scripts/searchKB.js "I can't log in"`: top 3 topically correct — login
  troubleshooting (0.4848), password reset (0.3616), app crashing (0.3035).
- Full UI run (real ticket submitted through the form): "Stuck in a login loop after password
  reset" classified live as High/Negative/Technical. Solver panel on the created ticket:
  - Suggested KB articles: login troubleshooting (0.628), password reset (0.523), app slow (0.377)
    — same relative ranking as the CLI search, confirming the live endpoint matches the script.
  - Similar past tickets: **correctly showed no match** — "No close precedent (best score 0.568 <
    threshold 0.8)." This is the no-false-match case the threshold was chosen to guard against;
    0.80 holds up on a real near-but-not-quite-duplicate (login loop vs. the seeded "locked out —
    lost phone" / "password reset email never arrives" tickets).
  - AI draft reply: grounded in the two login-relevant KB articles, placed in the reply box.
  - Handoff summary: accurate 3-sentence summary of the single opening message (no thread yet),
    correctly noted no troubleshooting had been performed.

**Local dev harness note:** `preview_start` (this tool's dev-server launcher) injects `PORT` into
the whole `npm run dev` process tree to detect the server port; since this repo runs two dev
servers (client on 5173, API on 5001) under one `concurrently` parent, that env var leaked into the
API process too and made it bind to 5173 instead of 5001 (colliding with Vite). Not an app bug —
worked around by starting `npm run dev` directly instead of through the launcher-injected env.

**Outcome:** every item queued behind the Pinecone block is now confirmed against live services.
The 0.80 similarity threshold needs no adjustment based on this run.

## Phase 9 — Migration to Supabase (Postgres + Auth + RLS + Edge Functions), Cloudflare Pages deploy

**Context:** user requested a full migration off MongoDB/Mongoose/Pinecone/Express onto Supabase —
real three-tier RBAC (`user`/`salesperson`/`admin`) enforced by RLS (not just UI), persistent
per-message chat threads instead of an embedded array, and email notifications on ticket
updates/replies — then a Cloudflare deployment. Target: existing Supabase project `mern_project`
(`fhpcbqytazkayjdbmszv`, ap-southeast-2). Architecture decision: retire Express entirely — the
client talks to Postgres directly via `supabase-js` (RLS-enforced), and every operation needing a
secret key (LLM calls, embeddings, email) runs as a Supabase Edge Function. Cloudflare only ever
hosts the static built frontend.

**Schema + RLS (verified 2026-07-15):** `profiles`/`tickets`/`ticket_messages`/`kb_articles`
(`embedding vector(768)`)/`ticket_embeddings` tables, `pgvector` extension, RLS policies per the
spec's role model. Two corrections made to the user-provided spec and documented at the time: (1)
the spec's self-referential-subquery approach to blocking role escalation was fragile — replaced
with a `BEFORE UPDATE` trigger comparing `NEW.role IS DISTINCT FROM OLD.role` against
`current_role() = 'admin'`; (2) the staff `ticket_messages` insert policy didn't pin
`sender_id = auth.uid()`, letting any staff member post as another — fixed. `sender_role` is
derived server-side from the sender's actual profile via a `BEFORE INSERT` trigger rather than
trusted from client input, since the email-notification logic depends on it being unspoofable.
Security-linter findings resolved: function `search_path` hardening, extensions moved out of
`public` (`pg_net` can't be moved — accepted, not a real vulnerability), and `SECURITY DEFINER`
helper functions explicitly revoked from `anon`/`authenticated` where they're internal-only
(discovered mid-fix that Supabase grants `EXECUTE` directly to `anon`/`authenticated` by default,
not just via `PUBLIC` — revoking from `PUBLIC` alone doesn't remove it).

**Seed data (verified):** the 12 KB articles and 8 resolved tickets from the old
`seedKB.js`/`seedClosedTickets.js` ported verbatim into `scripts/seed-supabase.mjs`, embedded via
Gemini `gemini-embedding-001` (truncated to 768 dims via `outputDimensionality` — `text-embedding-004`
isn't available on this API key). Seeded tickets need a real `profiles.id`, so one synthetic
"historical tickets" auth user was created directly via SQL insert into `auth.users` (the normal
signup endpoint hit its per-project email rate limit); this uncovered a real Supabase gotcha —
raw-SQL-inserted `auth.users` rows need `''` (not `NULL`) in `confirmation_token`/`recovery_token`/etc.,
or GoTrue's Go scanner 500s on any login attempt for that row ("converting NULL to string is
unsupported"). Final counts verified equal on both sides: 12 KB articles, 8 tickets, 16 messages, 8
embeddings.

**Edge Functions (deployed and verified 2026-07-15):** `classify-ticket`, `kb-search`,
`similar-tickets`, `draft-reply` (now persists the draft as an `is_ai_draft`/`internal_only`
message row per the spec, not just returned text), `summarize-ticket`, `embed-kb-article`,
`send-ticket-update-email` — LLM/prompt logic ported verbatim from the old `server/src/lib/*.js`.
Secrets set via `supabase secrets set` using a user-supplied personal access token (no MCP tool
exposes secret-setting or the project's `service_role` key directly). Real bug found and fixed:
the `kb_articles`/`ticket_embeddings` `ivfflat` indexes (`lists = 100`) were absurdly
over-partitioned for 12 and 8 rows respectively — confirmed via a direct RPC call that
`match_kb_articles` returned only 1 row instead of 3 for a query whose top hit should have been an
exact self-match. Dropped both indexes; at this row count an unindexed sequential scan is exact
and fast. Re-verified after the fix: 3 relevant KB articles returned with sensible scores
(0.73/0.71/0.61) for a login-loop query, matching the Phase 8 Pinecone-era results.

**Email pipeline (verified live, real delivery):** the `pg_net` trigger's default 5000ms timeout
was too short for a cold Edge Function's Gmail SMTP handshake — the first live status-change test
timed out (`net._http_response.timed_out = true`). Fixed by passing `timeout_milliseconds := 20000`
to both trigger functions. Re-verified: a real status change produced `{"sent":true,"to":"..."}` in
`net._http_response`, delivered to a real inbox. Also verified the customer-reply-doesn't-email
case by inserting a message from a genuine `user`-role sender and confirming
`net._http_response`'s row count didn't change.

**Frontend (verified live in-browser):** `@supabase/supabase-js` client, `AuthContext` (session +
profile/role), route guards, `/login`, `/submit`, `/tickets` + `/tickets/:id` (customer, realtime
message updates), `/agent` + `/agent/tickets/:id` (staff, URL-addressable selection unlike the old
state-only selection), `/admin` (role management, KB CRUD, analytics). Two real bugs found and
fixed via live testing, not just code review:
1. Right after sign-in, `role` was briefly `undefined` (profile fetch hadn't resolved yet) —
   `ProtectedRoute` denied the destination route and bounced back to `/`, which redirected to the
   same destination, which denied again: an infinite render loop (`Maximum update depth exceeded`,
   confirmed via console + a frozen renderer). Fixed by making `AuthContext`'s `loading` flag cover
   the profile fetch, not just the session fetch, and simplified to a single `onAuthStateChange`
   subscriber (removed a redundant parallel `getSession()` call that raced it).
2. `Admin.jsx` used `useEffect(load, [])` where `load` returns a Promise — React rejects a
   non-cleanup-function return from an effect and the component crashed silently (blank page, no
   thrown error visible without checking console). Fixed both occurrences to wrap in a bare
   arrow function.

**RLS verified as the actual enforcement (not just UI), 2026-07-15:** created a second real
customer account, obtained its JWT via the password grant, and issued direct PostgREST calls (not
through the UI): confirmed it cannot read the first customer's ticket by ID (empty result), cannot
read other users' profile rows, cannot self-promote its own role (blocked by the guard trigger:
`"only admins can change a profile role"`), cannot insert a message onto another customer's ticket
(`42501`), and cannot insert a KB article (`42501`, staff-only). All five checks behaved exactly as
designed.

**Live UI verification:** signed up a real test account (`user` role auto-assigned), submitted a
ticket, watched live classification (High/Negative/Technical for a login-loop ticket, matching
Phase 8). Bootstrapped that account to `admin` via one `execute_sql` UPDATE (no admin exists on a
fresh system by design). Verified `/admin` (analytics, role dropdowns, KB CRUD), `/agent` (all
tickets visible to staff), and the full solver panel (KB matches, similar tickets — correctly
"no close precedent" at 0.749 < 0.80, AI draft grounded in the right articles, summary accurate).

**Cleanup:** `server/` (Express/Mongoose/Pinecone) deleted — all files removed; the empty top-level
directory itself couldn't be removed because the user's own IDE language server had it open
(confirmed via `Get-CimInstance Win32_Process`, not one of this session's own processes — left
alone rather than force-killing an unrelated editor process). `package.json` simplified to just
build/serve the client. `README.md` rewritten for the new stack.

**Cloudflare Pages deployment (verified live):** `wrangler` was already authenticated on this
machine with `pages (write)` scope — no token exchange needed. Created project `smartsupport`,
built the client (`vite build`, `_redirects` confirmed copied into `dist/`), and deployed to the
`main` branch so it serves the project's stable root domain rather than a per-deploy/per-branch
hash URL. Live at **https://smartsupport-b48.pages.dev**. Verified by logging in on the deployed
site itself (not just localhost): admin login → redirect to `/admin` → analytics, role table, and
all 12 KB articles rendered correctly with zero console errors.

**Redeploy command** (after future changes): `npm run build --prefix client && npx wrangler pages
deploy client/dist --project-name=smartsupport --branch=main`.

**Outcome:** all nine phases done and verified live, including on the deployed Cloudflare URL —
schema/RLS, seed data, six Edge Functions, full frontend rewrite, email pipeline, and the
production deployment itself.

## Phase 10 — LLM two-provider fallback exhausted; missing RLS UPDATE policy (bugs, live-verified)

**LLM fallback exhausted (2026-07-16):** a real ticket failed to classify — OpenRouter primary was
rate-limited and the Gemini fallback returned 503 ("high demand"), leaving no working provider.
User supplied a second OpenRouter API key. Added it as a genuine third tier
(`OPENROUTER_API_KEY_2` / `OPENROUTER_MODEL_2`, defaulting to `google/gemma-4-31b-it:free`) to
`classify-ticket`, `draft-reply`, and `summarize-ticket` — the chain is now primary key → secondary
key (separate account, separate free-tier quota) → Gemini. Set via `supabase secrets set`,
redeployed, and verified live: classification succeeded on a fresh test ticket where it previously
errored out.

**Missing `ticket_messages` UPDATE policy (2026-07-16):** editing an AI draft and clicking "Send"
failed with PostgREST's `"Cannot coerce the result to a single JSON object"`. Root cause: RLS was
enabled on `ticket_messages` with SELECT and INSERT policies but **no UPDATE policy at all** —
Postgres default-denies with RLS on and no matching policy, so `tickets.sendDraft`'s
`UPDATE ... .select().single()` matched zero rows and PostgREST couldn't coerce an empty result
into one object. Fixed with a tightly-scoped policy: staff may update a `ticket_messages` row only
while it is *currently* `is_ai_draft = true` (finalizing a draft into a real sent message) —
already-sent messages stay immutable/append-only per the original chat-thread design. Verified live
via direct PostgREST calls with a real staff JWT: the send-draft UPDATE now succeeds and returns
exactly one row, and a second attempt to edit the same (now non-draft) row correctly returns empty
— confirming the policy is scoped as tightly as intended, not just "any staff update allowed."

## Phase 11 — Multilingual support, Auto-Close Agent, Voice-to-Text

**Architecture:** translation and auto-close are fully server-side and trigger-driven (DB trigger →
`pg_net` → Edge Function, the same pattern as the email pipeline), not client-orchestrated — the
client makes zero extra calls for either. Voice transcription stays client-invoked and synchronous
(the user is actively waiting to review the transcript). New columns:
`tickets.detected_language`/`subject_translated`/`auto_closed_by_ai`,
`ticket_messages.body_translated`/`is_voice_transcript`.

**translate-message** (trigger-invoked on `ticket_messages` INSERT and on the
draft-finalize UPDATE transition): bootstraps `detected_language` + `subject_translated` from the
first non-English message seen on a ticket, then translates each subsequent message — customer →
English, staff → the ticket's language — into `body_translated`. No-ops entirely once a ticket is
confirmed English.

**check-auto-close** (trigger-invoked on customer `ticket_messages` INSERT, skipping the ticket's
first message and already-resolved tickets): strict LLM classifier on the raw message body (no
translation dependency — Gemini handles non-English input natively) decides if a follow-up is
*purely* a closing remark. Per the user's explicit choice, this is **fully automatic** — no agent
confirmation step — setting `status='resolved'`, `auto_closed_by_ai=true`, and an AI-written
resolution summary, which reuses the already-verified `tickets_notify_status_change` email trigger
with no new email code.

**Bonus fix applied while adding the draft-finalize trigger:** `notify_staff_reply` only fired on
INSERT, so an agent finalizing an AI draft via the UPDATE path (Phase 10's RLS fix) never emailed
the customer. Added the same UPDATE trigger for it.

**Real bug found and fixed while wiring the new realtime subscriptions:** the `supabase_realtime`
publication was empty — neither `tickets` nor `ticket_messages` had ever been added to it. Prior
"realtime" behavior in this app only *appeared* to work because each client saw its own
locally-initiated changes (e.g. an agent's own sent reply appending to their own state), not a
genuine cross-client push. Confirmed via `pg_publication_tables` returning zero rows. Fixed by
adding both tables to the publication — this fixes realtime for the *existing* chat feature too,
not just the new auto-close/translation live-updates.

**transcribe-voice-note model selection (verified live against this project's key, 2026-07-17):**
`gemini-2.0-flash` and `gemini-2.0-flash-lite` both returned 429 (quota exhausted on this key
specifically), `gemini-2.5-flash`/`gemini-2.5-flash-lite` returned 404 ("no longer available to new
users"). `gemini-flash-latest` works and transcribed a synthesized test clip (Windows
`System.Speech.Synthesis`) with an exact word-for-word match. Function deployed with that model.

**Verified live end-to-end (2026-07-17), via direct API calls (not just UI):**
- Translation, both directions: a Spanish first message correctly set `detected_language='es'`,
  translated the subject, and translated the body to English; a subsequent English staff reply
  correctly translated to Spanish in `body_translated`.
- Auto-close positive case: a Spanish "muchas gracias, ya pude iniciar sesión" follow-up correctly
  flipped the ticket to resolved with `auto_closed_by_ai=true` and fired the customer email
  (confirmed via `net._http_response`: `{"sent":true,...}`).
- Auto-close negative case (adversarial): a follow-up starting with "Thanks for looking into
  this" but containing genuinely new information ("it also happens on my phone") correctly did
  *not* auto-close — the "be conservative" prompt instruction held up under a realistic near-miss,
  not just an obvious case.
- Voice transcription: a real synthesized audio clip sent through the deployed
  `transcribe-voice-note` function returned an exact transcript match.

**Verified live in-browser, including genuine cross-client realtime (2026-07-17):** submitted a
ticket through the actual UI (regression check — classification still worked correctly after the
schema/trigger changes). Then, with an agent's ticket-detail view already open and *never
refreshed*, inserted a Spanish ticket + a Spanish "gracias, ya todo resuelto" follow-up via direct
SQL (an external client, not the browser) — watched the open browser tab update live and
unprompted: ticket list entry and detail header both flipped to Resolved with the "Auto-closed by
AI" badge, the new message appeared already translated to English with a "Show original (es)"
toggle, and the translated subject + "ES" language chip were both correct. This is the real test of
the realtime publication fix above, not just a reload-and-check.

**Outstanding:** the `VoiceNote` component's actual `MediaRecorder`/file-upload UI could not be
exercised through this session's browser automation (no file-input upload capability in the
available tools, and live microphone recording isn't meaningfully testable headlessly) — verified
instead by testing the deployed transcription function directly with real audio (above) and
confirming the component renders correctly with no console errors. Worth a manual check by the
user with a real microphone.

**2026-07-18 — swapped voice transcription to ElevenLabs Speech-to-Text (`scribe_v1`)**, per user
request, replacing the Gemini `gemini-flash-latest` approach above. Tested the raw ElevenLabs API
directly first (multipart `file` + `model_id=scribe_v1`, header `xi-api-key`) against the same
synthesized test clip before touching the function — exact transcript match, plus per-word
timestamps and language detection in the response (unused, but available if ever needed). Rewrote
`transcribe-voice-note` to decode the incoming base64 to bytes and POST as `multipart/form-data`
instead of Gemini's inline-base64 JSON shape; the function's client-facing contract
(`audio_base64`/`mime_type` in, `{transcript}` out) is unchanged, so `VoiceNote.jsx` needed no
changes. Secret `ELEVENLABS_API_KEY` set via the Supabase CLI. Redeployed and re-verified end-to-end
through the actual deployed function (not just the raw API) with the identical test request used
for the Gemini version — same exact transcript.
