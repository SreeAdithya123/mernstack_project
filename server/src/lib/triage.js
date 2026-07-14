import { chat } from './llm.js';

export const SENTIMENTS = ['Positive', 'Neutral', 'Negative', 'Angry'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const CATEGORIES = ['Billing', 'Technical', 'Feature Request'];

const SYSTEM_PROMPT = `You are the triage engine of a customer support help desk.
Classify the ticket you are given. Respond with ONLY a single JSON object — no markdown fences, no commentary, no reasoning steps — in exactly this shape:
{"sentiment": "Positive" | "Neutral" | "Negative" | "Angry", "priority": "High" | "Medium" | "Low", "category": "Billing" | "Technical" | "Feature Request"}

Guidelines:
- sentiment is the customer's emotional tone. Use "Angry" only for open hostility: threats to leave or chargeback, insults, shouting. A problem reported calmly or with mild frustration is "Negative". Friendly suggestions, praise, or thanks are "Positive". Purely factual questions are "Neutral".
- priority: "High" when the customer is blocked from working, money was wrongly taken, something is down for many users, or there is a security concern. "Low" for suggestions, cosmetic issues, and non-urgent questions. Everything in between is "Medium".
- category: "Billing" covers charges, refunds, invoices, subscriptions, orders, shipping and delivery. "Technical" covers errors, bugs, outages, performance, and login/access problems. "Feature Request" covers asking for new functionality or improvements to existing behaviour.`;

// The model may emit visible reasoning around (and containing) JSON fragments,
// so collect every balanced top-level {...} substring and use the last one
// that parses and carries the contract keys — the final answer comes last.
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

function normalizeEnum(value, allowed, field) {
  const match = allowed.find((a) => a.toLowerCase() === String(value).trim().toLowerCase());
  if (!match) {
    throw new Error(`invalid ${field} "${value}" (expected one of: ${allowed.join(', ')})`);
  }
  return match;
}

// Classifies a ticket's text into the fixed contract. One corrective retry if
// the model's first output isn't valid JSON in the contract.
export async function classifyTicket({ subject, text }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Subject: ${subject}\n\nMessage:\n${text}` },
  ];

  let raw = await chat(messages, { temperature: 0.1 });
  for (let attempt = 0; ; attempt++) {
    try {
      const parsed = extractJson(raw, ['sentiment', 'priority', 'category']);
      return {
        sentiment: normalizeEnum(parsed.sentiment, SENTIMENTS, 'sentiment'),
        priority: normalizeEnum(parsed.priority, PRIORITIES, 'priority'),
        category: normalizeEnum(parsed.category, CATEGORIES, 'category'),
      };
    } catch (err) {
      if (attempt >= 1) throw new Error(`classification failed: ${err.message}`);
      raw = await chat(
        [
          ...messages,
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content: `That output was invalid (${err.message}). Reply again with ONLY the JSON object, nothing else.`,
          },
        ],
        { temperature: 0.1 }
      );
    }
  }
}
