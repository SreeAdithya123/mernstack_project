// RAG-drafted reply grounded in the ticket's top-3 KB matches. Staff-only.
// Per the migration spec, the draft is persisted as a ticket_messages row
// (is_ai_draft = true, sender_id = null, internal_only = true so the
// customer never sees it) rather than just returned as text - the agent
// edits it in the reply box and "Send" inserts a fresh normal message.
// Ported from server/src/lib/draft.js + retrieval.js's kbMatchesForTicket.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are drafting a reply for a human customer support agent to review and send. You are given the ticket thread and excerpts from the company knowledge base retrieved for this ticket.

Rules:
- Ground every factual claim (steps, timeframes, policies, amounts) in the provided knowledge base excerpts. Do not invent policies or numbers that are not in them.
- If the excerpts don't fully answer the issue, say what the customer should provide or expect next instead of guessing.
- Tone: warm, professional, plain language. Use they/them pronouns unless the customer stated otherwise. Keep it under 180 words. No placeholders like [Agent Name] - end simply with "Best regards," and a line "The Support Team".
- This is a draft the agent will edit, but write it ready-to-send.

Respond with ONLY a single JSON object - no markdown fences, no commentary, no reasoning steps - in exactly this shape, with the whole reply in one string using \\n for line breaks:
{"reply": "..."}`;

function balancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) { depth--; if (depth === 0) { out.push(text.slice(start, i + 1)); start = -1; } }
  }
  return out;
}

function extractJson(text: string, requiredKeys: string[]) {
  const candidates = balancedObjects(text);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (requiredKeys.every((k) => k in parsed)) return parsed;
    } catch { /* keep scanning */ }
  }
  throw new Error(`no JSON object with keys [${requiredKeys}] in model output: ${text.slice(0, 120)}`);
}

async function chatOpenRouter(messages: unknown, temperature: number) {
  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: Deno.env.get('OPENROUTER_MODEL') || 'google/gemma-4-31b-it:free', messages, temperature }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${raw.slice(0, 300)}`);
  const content = JSON.parse(raw).choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(`OpenRouter returned no content: ${raw.slice(0, 300)}`);
  return content;
}

async function chatGemini(messages: Array<{ role: string; content: string }>, temperature: number, attempt = 1): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body: Record<string, unknown> = { contents, generationConfig: { temperature } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const model = Deno.env.get('GEMINI_MODEL') || 'gemma-4-31b-it';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    if ((res.status === 503 || res.status === 429) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2500 * attempt));
      return chatGemini(messages, temperature, attempt + 1);
    }
    throw new Error(`Gemini ${res.status}: ${raw.slice(0, 300)}`);
  }
  const parts = JSON.parse(raw).candidates?.[0]?.content?.parts;
  const text = (parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) throw new Error(`Gemini returned no text: ${raw.slice(0, 300)}`);
  return text;
}

async function chat(messages: Array<{ role: string; content: string }>, temperature: number) {
  const hasOpenRouter = !!Deno.env.get('OPENROUTER_API_KEY');
  if (hasOpenRouter) {
    try {
      return await chatOpenRouter(messages, temperature);
    } catch (err) {
      if (!Deno.env.get('GEMINI_API_KEY')) throw err;
      console.warn(`OpenRouter failed (${String((err as Error).message).slice(0, 120)}); falling back to Gemini`);
    }
  }
  return chatGemini(messages, temperature);
}

async function chatJson(messages: Array<{ role: string; content: string }>, requiredKeys: string[], temperature: number, validate: (o: any) => any) {
  let raw = await chat(messages, temperature);
  for (let attempt = 0; ; attempt++) {
    try {
      return validate(extractJson(raw, requiredKeys));
    } catch (err) {
      if (attempt >= 1) throw new Error(`structured output failed: ${(err as Error).message}`);
      raw = await chat(
        [...messages, { role: 'assistant', content: raw }, { role: 'user', content: `That output was invalid (${(err as Error).message.slice(0, 160)}). Reply again with ONLY the JSON object and nothing else.` }],
        temperature
      );
    }
  }
}

async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text }] }, outputDimensionality: 768 }),
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

    const { data: messages } = await admin
      .from('ticket_messages')
      .select('sender_role, body, created_at')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true });

    const thread = (messages ?? []).map((m) => `[${m.sender_role ?? 'system'}]\n${m.body}`).join('\n\n');

    const firstMessage = (messages ?? [])[0]?.body ?? '';
    const vector = await embed(`${ticket.subject}\n${firstMessage}`);
    const { data: kbMatches, error: matchErr } = await admin.rpc('match_kb_articles', { query_embedding: vector, match_count: 3 });
    if (matchErr) throw new Error(`KB search failed: ${matchErr.message}`);

    const context = (kbMatches ?? [])
      .map((m: any, i: number) => `--- Article ${i + 1}: ${m.title} ---\n${m.content}`)
      .join('\n\n');

    const reply = await chatJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Subject: ${ticket.subject}\n\nThread so far:\n${thread}\n\nRetrieved knowledge base excerpts:\n${context}` },
      ],
      ['reply'],
      0.4,
      (parsed) => {
        const r = String(parsed.reply).trim();
        if (!r) throw new Error('reply is empty');
        return r;
      }
    );

    const { data: draftRow, error: insertErr } = await admin
      .from('ticket_messages')
      .insert({ ticket_id, sender_id: null, sender_role: 'salesperson', body: reply, is_ai_draft: true, internal_only: true })
      .select()
      .single();
    if (insertErr) throw new Error(`failed to persist draft: ${insertErr.message}`);

    const sources = (kbMatches ?? []).map((m: any) => ({ articleId: m.id, title: m.title, score: m.score }));

    return new Response(JSON.stringify({ draft: draftRow, sources }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
