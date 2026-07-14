import { chatJson } from './llm.js';

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

function normalizeEnum(value, allowed, field) {
  const match = allowed.find((a) => a.toLowerCase() === String(value).trim().toLowerCase());
  if (!match) {
    throw new Error(`invalid ${field} "${value}" (expected one of: ${allowed.join(', ')})`);
  }
  return match;
}

// Classifies a ticket's text into the fixed contract.
export function classifyTicket({ subject, text }) {
  return chatJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Subject: ${subject}\n\nMessage:\n${text}` },
    ],
    ['sentiment', 'priority', 'category'],
    {
      temperature: 0.1,
      validate: (parsed) => ({
        sentiment: normalizeEnum(parsed.sentiment, SENTIMENTS, 'sentiment'),
        priority: normalizeEnum(parsed.priority, PRIORITIES, 'priority'),
        category: normalizeEnum(parsed.category, CATEGORIES, 'category'),
      }),
    }
  );
}
