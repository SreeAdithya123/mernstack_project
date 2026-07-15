# SmartSupport

Intelligent customer service triage & resolution hub with three-tier access control. A customer
submits a ticket, an LLM classifies it (sentiment / priority / category), Supabase (pgvector)
retrieves grounding context from a knowledge base and from past resolved tickets, the LLM drafts a
reply, and a human agent reviews and sends it. Every reply — customer or agent — persists as a row
in a chat thread, and the customer gets emailed on status changes and agent replies.

## Stack

- **Frontend:** React 19 + Vite + Tailwind CSS + `react-router-dom` (`client/`) — deployed as a
  static site to Cloudflare Pages.
- **Backend:** Supabase — Postgres (with Row Level Security as the actual access-control
  enforcement, not just the UI), Auth (email/password, three roles: `user` / `salesperson` /
  `admin`), Realtime (live chat updates), and Edge Functions (`supabase/functions/`) for anything
  needing a secret API key: LLM classification/drafting/summarizing, embedding generation + vector
  search, and email notifications.
- **Vector search:** pgvector on two tables (`kb_articles.embedding`, `ticket_embeddings.embedding`,
  both `vector(768)`) — no separate vector DB. At this data volume (dozens to low hundreds of rows)
  an unindexed sequential scan is used deliberately: an `ivfflat` index was tried and found to
  silently miss most rows because it was over-partitioned relative to the row count (see
  `BUILD_LOG.md` Phase D). Add an index (`ivfflat` or `hnsw`) once the tables are large enough for
  it to help — check with `explain analyze`, don't add it preemptively.
- **LLM:** OpenRouter (`google/gemma-4-31b-it:free`) primary, Gemini API fallback on any OpenRouter
  failure (rate limit, quota, blocked host) — same dual-provider logic ported into every Edge
  Function that calls an LLM.
- **Embeddings:** Google `gemini-embedding-001` truncated to 768 dims via `outputDimensionality`.
- **Email:** Gmail SMTP (`denomailer`) from the `send-ticket-update-email` Edge Function, invoked by
  a Postgres trigger (`pg_net`) on ticket status changes and staff replies — never on a customer's
  own reply. The trigger authenticates to the function with a shared secret (not a JWT — Postgres
  triggers have no end-user session), checked against `WEBHOOK_SHARED_SECRET`.

## Setup

1. `npm run install:all`
2. Copy `client/.env.example` to `client/.env` and fill in `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` from your Supabase project settings (both are safe to expose
   client-side — RLS is what actually enforces access, not these values).
3. `npm run dev` — starts the client on http://localhost:5173 (or the next free port).
4. Sign up through the app; the first account should be promoted to `admin` directly in Supabase
   (`update public.profiles set role = 'admin' where email = '...'`) since there's no self-service
   path to staff roles by design (see the RLS policies in `supabase/functions` migrations run via
   the Supabase MCP / dashboard SQL editor).

## Supabase Edge Functions

| Function | Purpose | Auth |
| --- | --- | --- |
| `classify-ticket` | Sentiment/priority/category via LLM, writes onto the ticket | ticket owner or staff |
| `kb-search` | Top-3 KB articles for a ticket via pgvector | staff only |
| `similar-tickets` | Past resolved tickets above the similarity threshold (0.80) | staff only |
| `draft-reply` | RAG-drafted reply, persisted as an `is_ai_draft` message row | staff only |
| `summarize-ticket` | Handoff summary, written onto the ticket | staff only |
| `embed-kb-article` | (Re)computes a KB article's embedding after admin create/edit | staff only |
| `send-ticket-update-email` | Gmail SMTP send, fired by a DB trigger | shared secret, not JWT |

Deploy with the Supabase MCP's `deploy_edge_function` (or `supabase functions deploy` via the CLI).
Secrets (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
`WEBHOOK_SHARED_SECRET`, etc.) are set via `supabase secrets set --project-ref <ref>`.

## Repo layout

```
client/
  src/lib/supabase.js       Supabase client (anon key)
  src/lib/tickets.js        Ticket/message CRUD + Edge Function calls (customer + staff)
  src/lib/admin.js          Role management, KB article CRUD, analytics
  src/context/AuthContext.jsx  Session + profile/role, single source of truth for auth state
  src/components/ProtectedRoute.jsx  Client-side route guard (UX only — RLS is the real check)
  src/pages/                Login, SubmitTicket, MyTickets, TicketThread, AgentDashboard, Admin
supabase/
  functions/                Deno Edge Functions, one directory per function
scripts/
  seed-supabase.mjs         One-time KB + closed-ticket seed data with real embeddings
```

## Build status

See `BUILD_LOG.md` for the phase-by-phase log of what is built and what has actually been verified
against live services, including the Mongo/Pinecone-era history this project migrated from.
