import config from '../config.js';

// Chat with the OpenRouter-hosted model. `messages` is OpenAI-style
// [{ role, content }]; returns the assistant message content as a string.
export async function chat(messages, { temperature = 0.4 } = {}) {
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
  const body = JSON.parse(raw);
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`OpenRouter returned no message content: ${raw.slice(0, 300)}`);
  }
  return content;
}

export function generateText(prompt, opts) {
  return chat([{ role: 'user', content: prompt }], opts);
}
