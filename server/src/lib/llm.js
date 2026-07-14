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
