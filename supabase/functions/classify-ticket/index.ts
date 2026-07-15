// Classifies a ticket's sentiment/priority/category via LLM (OpenRouter
// primary, Gemini fallback) and writes the result onto the ticket row.
// Called synchronously by the client right after ticket creation - preserves
// the "Submitting - AI triage takes a few seconds..." UX from the old
// Express app. Ported from server/src/lib/triage.js + llm.js.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SENTIMENTS = ['positive', 'neutral', 'negative', 'angry'];
const PRIORITIES = ['low', 'medium', 'high'];
const CATEGORIES = ['billing', 'technical', 'feature_request', 'other'];

const SYSTEM_PROMPT = `You are the triage engine of a customer support help desk.
Classify the ticket you are given. Respond with ONLY a single JSON object - no markdown fences, no commentary, no reasoning steps - in exactly this shape:
{"sentiment": "positive" | "neutral" | "negative" | "angry", "priority": "high" | "medium" | "low", "category": "billing" | "technical" | "feature_request" | "other"}

Guidelines:
- sentiment is the customer's emotional tone. Use "angry" only for open hostility: threats to leave or chargeback, insults, shouting. A problem reported calmly or with mild frustration is "negative". Friendly suggestions, praise, or thanks are "positive". Purely factual questions are "neutral".
- priority: "high" when the customer is blocked from working, money was wrongly taken, something is down for many users, or there is a security concern. "low" for suggestions, cosmetic issues, and non-urgent questions. Everything in between is "medium".
- category: "billing" covers charges, refunds, invoices, subscriptions, orders, shipping and delivery. "technical" covers errors, bugs, outages, performance, and login/access problems. "feature_request" covers asking for new functionality. "other" is anything that doesn't fit those three.`;

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

function normalizeEnum(value: unknown, allowed: string[], field: string) {
  const match = allowed.find((a) => a === String(value).trim().toLowerCase());
  if (!match) throw new Error(`invalid ${field} "${value}" (expected one of: ${allowed.join(', ')})`);
  return match;
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

    const { data: ticket, error: ticketErr } = await admin
      .from('tickets')
      .select('id, customer_id, subject')
      .eq('id', ticket_id)
      .single();
    if (ticketErr || !ticket) throw new Error('ticket not found');

    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    const isOwner = ticket.customer_id === user.id;
    const isStaff = profile?.role === 'salesperson' || profile?.role === 'admin';
    if (!isOwner && !isStaff) throw new Error('forbidden');

    const { data: firstMessage } = await admin
      .from('ticket_messages')
      .select('body')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const classification = await chatJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Subject: ${ticket.subject}\n\nMessage:\n${firstMessage?.body ?? ''}` },
      ],
      ['sentiment', 'priority', 'category'],
      0.1,
      (parsed) => ({
        sentiment: normalizeEnum(parsed.sentiment, SENTIMENTS, 'sentiment'),
        priority: normalizeEnum(parsed.priority, PRIORITIES, 'priority'),
        category: normalizeEnum(parsed.category, CATEGORIES, 'category'),
      })
    );

    const { error: updateErr } = await admin.from('tickets').update(classification).eq('id', ticket_id);
    if (updateErr) throw new Error(`failed to save classification: ${updateErr.message}`);

    return new Response(JSON.stringify(classification), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
