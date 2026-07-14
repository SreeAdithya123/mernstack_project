import config from '../config.js';

// `messages` is OpenAI-style [{ role: 'system'|'user'|'assistant', content }].
// OpenRouter is the primary provider; any OpenRouter failure (quota exhausted,
// rate limit, blocked host) falls back to the Gemini API when a key is set.
// Returns { text, provider }.
export async function chatDetailed(messages, { temperature = 0.4 } = {}) {
  let openrouterError;
  if (config.openrouterApiKey) {
    try {
      return { text: await chatOpenRouter(messages, temperature), provider: 'openrouter' };
    } catch (err) {
      if (!config.geminiApiKey) throw err;
      openrouterError = err;
      console.warn(`OpenRouter failed (${String(err.message).slice(0, 120)}); falling back to Gemini`);
    }
  }
  if (!config.geminiApiKey) {
    throw new Error('No LLM configured: set OPENROUTER_API_KEY or GEMINI_API_KEY');
  }
  try {
    return { text: await chatGemini(messages, temperature), provider: 'gemini' };
  } catch (err) {
    if (openrouterError) err.message += ` (after OpenRouter failure: ${openrouterError.message.slice(0, 80)})`;
    throw err;
  }
}

export async function chat(messages, opts) {
  return (await chatDetailed(messages, opts)).text;
}

export function generateText(prompt, opts) {
  return chat([{ role: 'user', content: prompt }], opts);
}

// The model may emit visible reasoning around (and containing) JSON fragments,
// so collect every balanced top-level {...} substring and use the last one
// that parses and carries the required keys — the final answer comes last.
function balancedObjects(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function extractJson(text, requiredKeys) {
  const candidates = balancedObjects(text);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (requiredKeys.every((k) => k in parsed)) return parsed;
    } catch {
      // not valid JSON — keep scanning earlier candidates
    }
  }
  throw new Error(`no JSON object with keys [${requiredKeys}] in model output: ${text.slice(0, 120)}`);
}

// Chat for tasks with structured output: extracts the answer JSON from the
// model's output, runs `validate` (which may transform the value or throw),
// and gives the model one corrective retry before giving up.
export async function chatJson(messages, requiredKeys, { temperature = 0.2, validate = (o) => o } = {}) {
  let raw = await chat(messages, { temperature });
  for (let attempt = 0; ; attempt++) {
    try {
      return validate(extractJson(raw, requiredKeys));
    } catch (err) {
      if (attempt >= 1) throw new Error(`structured output failed: ${err.message}`);
      raw = await chat(
        [
          ...messages,
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content: `That output was invalid (${err.message.slice(0, 160)}). Reply again with ONLY the JSON object — all string values on a single line with \\n for line breaks — and nothing else.`,
          },
        ],
        { temperature }
      );
    }
  }
}

async function chatOpenRouter(messages, temperature) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: config.openrouterModel, messages, temperature }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${raw.slice(0, 300)}`);
  }
  const content = JSON.parse(raw).choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`OpenRouter returned no message content: ${raw.slice(0, 300)}`);
  }
  return content;
}

async function chatGemini(messages, temperature, attempt = 1) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const body = { contents, generationConfig: { temperature } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': config.geminiApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const raw = await res.text();
  if (!res.ok) {
    // 503 = temporary demand spike, 429 = rate limit; both are worth one retry.
    if ((res.status === 503 || res.status === 429) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2500 * attempt));
      return chatGemini(messages, temperature, attempt + 1);
    }
    throw new Error(`Gemini ${res.status}: ${raw.slice(0, 300)}`);
  }
  const parts = JSON.parse(raw).candidates?.[0]?.content?.parts;
  const text = (parts ?? []).map((p) => p.text ?? '').join('');
  if (!text) {
    throw new Error(`Gemini returned no text: ${raw.slice(0, 300)}`);
  }
  return text;
}
