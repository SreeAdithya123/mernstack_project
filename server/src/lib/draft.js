import { chatJson } from './llm.js';

const SYSTEM_PROMPT = `You are drafting a reply for a human customer support agent to review and send. You are given the ticket thread and excerpts from the company knowledge base retrieved for this ticket.

Rules:
- Ground every factual claim (steps, timeframes, policies, amounts) in the provided knowledge base excerpts. Do not invent policies or numbers that are not in them.
- If the excerpts don't fully answer the issue, say what the customer should provide or expect next instead of guessing.
- Tone: warm, professional, plain language. Address the customer by name; use they/them pronouns unless the customer stated otherwise. Keep it under 180 words. No placeholders like [Agent Name] — end simply with "Best regards," and a line "The Support Team".
- This is a draft the agent will edit, but write it ready-to-send.

Respond with ONLY a single JSON object — no markdown fences, no commentary, no reasoning steps — in exactly this shape, with the whole reply in one string using \\n for line breaks:
{"reply": "..."}`;

export async function draftReply(ticket, kbMatches) {
  const thread = ticket.messages.map((m) => `[${m.author}]\n${m.text}`).join('\n\n');
  const context = kbMatches
    .map((m, i) => `--- Article ${i + 1}: ${m.article.title} ---\n${m.article.body}`)
    .join('\n\n');

  return chatJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Customer name: ${ticket.submitterName}\nSubject: ${ticket.subject}\n\nThread so far:\n${thread}\n\nRetrieved knowledge base excerpts:\n${context}`,
      },
    ],
    ['reply'],
    {
      temperature: 0.4,
      validate: (parsed) => {
        const reply = String(parsed.reply).trim();
        if (!reply) throw new Error('reply is empty');
        return reply;
      },
    }
  );
}
