// Trigger-invoked (pg_net, shared secret) right after classify-ticket sets a
// ticket's priority for the first time. Non-high-priority tickets get a
// grounded, warm AI reply and are auto-resolved; high-priority tickets are
// deliberately excluded here and left in the normal queue for a human agent
// (see migration 016's trigger_auto_resolve_ticket for the exact gate).
//
// The reply is inserted as a REAL message (not an internal draft), which
// automatically triggers translate-message on INSERT - so a non-English
// ticket gets this reply translated and emailed to the customer in their own
// language via the same pipeline a human agent's reply goes through.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

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

const SYSTEM_PROMPT = `You are closing out a low- or medium-priority customer support ticket on behalf of the support team, grounded in the company's knowledge base. Write a warm, genuinely appreciative reply that:
- Thanks the customer for reaching out.
- Directly and helpfully addresses their message, grounding every factual claim (steps, timeframes, policies, amounts) ONLY in the provided knowledge base excerpts - never invent policies, numbers, or steps not present in them.
- If the excerpts don't fully cover the issue, say plainly what to expect next instead of guessing, but still close warmly.
- Ends on a genuinely positive, grateful note.

Tone: warm, professional, plain language. Use they/them pronouns unless the customer stated otherwise. Keep the reply under 160 words. No placeholders like [Agent Name] - end simply with "Best regards," and a line "The Support Team".

Also write a one-sentence internal resolution summary (for the ticket record only, never shown to the customer) describing what was resolved.

Respond with ONLY a single JSON object - no markdown fences, no commentary, no reasoning steps - in exactly this shape, each value as one string (use \\n only if a line break is essential):
{"reply": "...", "resolution_summary": "..."}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const secret = req.headers.get('x-webhook-secret');
    if (!secret || secret !== Deno.env.get('WEBHOOK_SHARED_SECRET')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { ticket_id } = await req.json();
    if (!ticket_id) throw new Error('ticket_id required');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: ticket, error: ticketErr } = await admin
      .from('tickets')
      .select('id, subject, status, customer_id, priority')
      .eq('id', ticket_id)
      .single();
    if (ticketErr || !ticket) throw new Error('ticket not found');
    if (ticket.status !== 'open') {
      return new Response(JSON.stringify({ skipped: `status is ${ticket.status}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (ticket.priority === 'high') {
      return new Response(JSON.stringify({ skipped: 'high priority - human review' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: messages } = await admin
      .from('ticket_messages')
      .select('id, sender_id, sender_role, body, created_at')
      .eq('ticket_id', ticket_id)
      .order('created_at', { ascending: true });

    // Safety check: if a human agent has already jumped in (fast response),
    // don't override them with an auto-reply.
    if ((messages ?? []).some((m) => m.sender_id !== ticket.customer_id)) {
      return new Response(JSON.stringify({ skipped: 'staff already engaged' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const thread = (messages ?? []).map((m) => `[${m.sender_role ?? 'customer'}]\n${m.body}`).join('\n\n');
    const firstMessage = (messages ?? [])[0]?.body ?? '';

    const vector = await embed(`${ticket.subject}\n${firstMessage}`);
    const { data: kbMatches, error: matchErr } = await admin.rpc('match_kb_articles', { query_embedding: vector, match_count: 3 });
    if (matchErr) throw new Error(`KB search failed: ${matchErr.message}`);

    const context = (kbMatches ?? [])
      .map((m: any, i: number) => `--- Article ${i + 1}: ${m.title} ---\n${m.content}`)
      .join('\n\n');

    const { reply, resolutionSummary } = await chatJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Subject: ${ticket.subject}\n\nThread so far:\n${thread}\n\nRetrieved knowledge base excerpts:\n${context}` },
      ],
      ['reply', 'resolution_summary'],
      0.4,
      (parsed) => {
        const r = String(parsed.reply).trim();
        const s = String(parsed.resolution_summary).trim();
        if (!r) throw new Error('reply is empty');
        if (!s) throw new Error('resolution_summary is empty');
        return { reply: r, resolutionSummary: s };
      }
    );

    const { error: insertErr } = await admin
      .from('ticket_messages')
      .insert({ ticket_id, sender_id: null, sender_role: 'salesperson', body: reply, is_ai_draft: false, internal_only: false });
    if (insertErr) throw new Error(`failed to insert auto-reply: ${insertErr.message}`);

    const { error: updateErr } = await admin
      .from('tickets')
      .update({ status: 'resolved', auto_closed_by_ai: true, resolution_summary: resolutionSummary })
      .eq('id', ticket_id);
    if (updateErr) throw new Error(`failed to resolve ticket: ${updateErr.message}`);

    return new Response(JSON.stringify({ resolved: true, resolution_summary: resolutionSummary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
