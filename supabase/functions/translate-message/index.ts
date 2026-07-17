// Trigger-invoked (pg_net, shared secret - no end-user JWT). Runs on every real
// ticket_messages INSERT and on the draft-finalize UPDATE transition.
// Bootstraps tickets.detected_language from the first non-English message seen
// on a ticket (translating the subject at the same time), then translates each
// subsequent message: customer -> English, staff -> the ticket's language.
// No-ops entirely once a ticket is confirmed English.
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

async function detectLanguage(text: string): Promise<{ isEnglish: boolean; language: string }> {
  return chatJson(
    [
      {
        role: 'system',
        content: `You detect the language of customer support messages. Respond with ONLY a single JSON object - no markdown fences, no commentary - in exactly this shape: {"is_english": true|false, "language": "<ISO 639-1 code>"}. Use "en" when is_english is true.`,
      },
      { role: 'user', content: text },
    ],
    ['is_english', 'language'],
    0,
    (parsed) => ({ isEnglish: Boolean(parsed.is_english), language: String(parsed.language).trim().toLowerCase() })
  );
}

async function translateText(text: string, targetLanguage: string): Promise<string> {
  return chatJson(
    [
      {
        role: 'system',
        content: `You are a precise translator for a customer support platform. Preserve tone and meaning; do not add commentary or notes. Respond with ONLY a single JSON object - no markdown fences - in exactly this shape: {"translated": "..."}`,
      },
      { role: 'user', content: `Translate the following text to ${targetLanguage} (if it is an ISO 639-1 code, translate to that language):\n\n${text}` },
    ],
    ['translated'],
    0.2,
    (parsed) => String(parsed.translated).trim()
  ).then((r) => r);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const secret = req.headers.get('x-webhook-secret');
    if (!secret || secret !== Deno.env.get('WEBHOOK_SHARED_SECRET')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { message_id } = await req.json();
    if (!message_id) throw new Error('message_id required');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: message, error: msgErr } = await admin
      .from('ticket_messages')
      .select('id, ticket_id, sender_id, body, is_ai_draft, internal_only')
      .eq('id', message_id)
      .single();
    if (msgErr || !message) throw new Error('message not found');
    if (message.is_ai_draft && message.internal_only) {
      return new Response(JSON.stringify({ skipped: 'pending draft' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: ticket, error: ticketErr } = await admin
      .from('tickets')
      .select('id, subject, customer_id, detected_language')
      .eq('id', message.ticket_id)
      .single();
    if (ticketErr || !ticket) throw new Error('ticket not found');

    let detectedLanguage = ticket.detected_language;

    if (detectedLanguage == null) {
      const detection = await detectLanguage(message.body);
      detectedLanguage = detection.isEnglish ? 'en' : detection.language;

      if (detection.isEnglish) {
        await admin.from('tickets').update({ detected_language: 'en' }).eq('id', ticket.id);
        return new Response(JSON.stringify({ detected: 'en', translated: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const subjectTranslated = await translateText(ticket.subject, 'English');
      await admin.from('tickets').update({ detected_language: detectedLanguage, subject_translated: subjectTranslated }).eq('id', ticket.id);
    } else if (detectedLanguage === 'en') {
      return new Response(JSON.stringify({ skipped: 'english ticket' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isFromCustomer = message.sender_id === ticket.customer_id;
    const target = isFromCustomer ? 'English' : detectedLanguage;
    const translated = await translateText(message.body, target);

    const { error: updateErr } = await admin.from('ticket_messages').update({ body_translated: translated }).eq('id', message.id);
    if (updateErr) throw new Error(`failed to save translation: ${updateErr.message}`);

    return new Response(JSON.stringify({ translated: true, direction: isFromCustomer ? 'to-english' : `to-${detectedLanguage}` }), {
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
