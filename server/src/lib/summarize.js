import { chatJson } from './llm.js';

const SYSTEM_PROMPT = `You are a support shift-handoff assistant. You are given a full support ticket thread. Write a concise handoff summary (3-5 sentences) for an agent taking over the ticket mid-shift.

The summary must cover: what the customer's issue is, the key facts and steps already taken, and the CURRENT state — what has been done, what is still pending, and the next expected action. Weight the latest messages appropriately; do not just restate the opening message. Refer to the customer by name, and use they/them pronouns unless the customer stated otherwise.

Respond with ONLY a single JSON object — no markdown fences, no commentary, no reasoning steps — in exactly this shape, with the whole summary in one string (use \\n only if a line break is essential):
{"summary": "..."}`;

export async function summarizeTicket(ticket) {
  const thread = ticket.messages
    .map((m) => `[${m.author}${m.timestamp ? ` — ${new Date(m.timestamp).toISOString().slice(0, 16)}` : ''}]\n${m.text}`)
    .join('\n\n');
  return chatJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Subject: ${ticket.subject}\nStatus: ${ticket.status}\n\nThread:\n${thread}` },
    ],
    ['summary'],
    {
      temperature: 0.3,
      validate: (parsed) => {
        const summary = String(parsed.summary).trim();
        if (!summary) throw new Error('summary is empty');
        return summary;
      },
    }
  );
}
