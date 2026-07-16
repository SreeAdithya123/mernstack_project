// Generates a concise handoff summary of the full thread and stores it on
// the ticket. Staff-only. Ported from server/src/lib/summarize.js.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a support shift-handoff assistant. You are given a full support ticket thread. Write a concise handoff summary (3-5 sentences) for an agent taking over the ticket mid-shift.

The summary must cover: what the customer's issue is, the key facts and steps already taken, and the CURRENT state - what has been done, what is still pending, and the next expected action. Weight the latest messages appropriately; do not just restate the opening message. Use they/them pronouns unless the customer stated otherwise.

Respond with ONLY a single JSON object - no markdown fences, no commentary, no reasoning steps - in exactly this shape, with the whole summary in one string (use \\n only if a line break is essential):
{"summary": "..."}`;

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

async function chatOpenRouter(messages: unknown, temperature: number, key: string, model: string) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature }),
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

// Provider chain: primary OpenRouter key/model, then a secondary OpenRouter
// key on a free model (a separate account's free-tier quota, for when the
// primary key is rate-limited), then Gemini as the last resort.
async function chat(messages: Array<{ role: string; content: string }>, temperature: number) {
  const openRouterAttempts: Array<[string, string]> = [];
  const primaryKey = Deno.env.get('OPENROUTER_API_KEY');
  if (primaryKey) openRouterAttempts.push([primaryKey, Deno.env.get('OPENROUTER_MODEL') || 'google/gemma-4-31b-it:free']);
  const secondaryKey = Deno.env.get('OPENROUTER_API_KEY_2');
  if (secondaryKey) openRouterAttempts.push([secondaryKey, Deno.env.get('OPENROUTER_MODEL_2') || 'google/gemma-4-31b-it:free']);

  let lastErr: Error | undefined;
  for (const [key, model] of openRouterAttempts) {
    try {
      return await chatOpenRouter(messages, temperature, key, model);
    } catch (err) {
      lastErr = err as Error;
      console.warn(`OpenRouter (${model}) failed: ${lastErr.message.slice(0, 120)}`);
    }
  }
  if (Deno.env.get('GEMINI_API_KEY')) {
    try {
      return await chatGemini(messages, temperature);
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error('no LLM provider configured');
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

    const { data: ticket, error: ticketErr } = await admin.from('tickets').select('id, subject, status').eq('id', ticket_id).single();
    if (ticketErr || !ticket) throw new Error('ticket not found');

    const { data: messages } = await admin
      .from('ticket_messages')
      .select('sender_role, body, created_at')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true });

    const thread = (messages ?? [])
      .map((m) => `[${m.sender_role ?? 'system'} - ${new Date(m.created_at).toISOString().slice(0, 16)}]\n${m.body}`)
      .join('\n\n');

    const summary = await chatJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Subject: ${ticket.subject}\nStatus: ${ticket.status}\n\nThread:\n${thread}` },
      ],
      ['summary'],
      0.3,
      (parsed) => {
        const s = String(parsed.summary).trim();
        if (!s) throw new Error('summary is empty');
        return s;
      }
    );

    const { error: updateErr } = await admin.from('tickets').update({ summary }).eq('id', ticket_id);
    if (updateErr) throw new Error(`failed to save summary: ${updateErr.message}`);

    return new Response(JSON.stringify({ summary }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
