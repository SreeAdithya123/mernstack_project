// Past resolved tickets that look like the same issue, via pgvector against
// ticket_embeddings. Staff-only. Ported from
// server/src/lib/retrieval.js's similarResolvedTickets - same
// SIMILARITY_THRESHOLD (0.80) semantics, now enforced in SQL.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIMILARITY_THRESHOLD = Number(Deno.env.get('SIMILARITY_THRESHOLD')) || 0.8;

async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    }
  );
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.embedding.values;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { ticket_id } = await req.json();
    if (!ticket_id) throw new Error('ticket_id required');

    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('unauthorized');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'salesperson' && profile?.role !== 'admin') throw new Error('forbidden');

    const { data: ticket, error: ticketErr } = await admin.from('tickets').select('id, subject').eq('id', ticket_id).single();
    if (ticketErr || !ticket) throw new Error('ticket not found');

    const { data: firstMessage } = await admin
      .from('ticket_messages')
      .select('body')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const queryText = `${ticket.subject}\n${firstMessage?.body ?? ''}`;
    const vector = await embed(queryText);

    const { data: candidates, error: matchErr } = await admin.rpc('match_similar_tickets', {
      query_embedding: vector,
      match_count: 3,
      exclude_ticket_id: ticket_id,
    });
    if (matchErr) throw new Error(`search failed: ${matchErr.message}`);

    const scored = candidates ?? [];
    const result = {
      threshold: SIMILARITY_THRESHOLD,
      matches: scored.filter((c: any) => c.score >= SIMILARITY_THRESHOLD),
      bestScore: scored[0]?.score ?? null,
    };

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
