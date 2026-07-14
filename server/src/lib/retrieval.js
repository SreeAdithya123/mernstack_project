import KBArticle from '../models/KBArticle.js';
import Ticket from '../models/Ticket.js';
import config from '../config.js';
import { embedQuery } from './embeddings.js';
import { getIndex, KB_NAMESPACE, CLOSED_TICKETS_NAMESPACE } from './pinecone.js';

// A ticket's retrieval text is its subject plus the first user message —
// that's the problem statement; agent replies would only add noise.
export function ticketQueryText(ticket) {
  const firstUserMessage = ticket.messages.find((m) => m.author === 'user')?.text ?? '';
  return `${ticket.subject}\n${firstUserMessage}`;
}

// Top-3 KB articles for a ticket, resolved to full Mongo documents.
export async function kbMatchesForTicket(ticket) {
  const vector = await embedQuery(ticketQueryText(ticket));
  const result = await getIndex().namespace(KB_NAMESPACE).query({
    vector,
    topK: 3,
    includeMetadata: true,
  });
  const matches = await Promise.all(
    (result.matches ?? []).map(async (m) => ({
      score: m.score,
      article: await KBArticle.findById(m.metadata.mongoId).lean(),
    }))
  );
  // An article deleted from Mongo but still indexed shouldn't surface.
  return matches.filter((m) => m.article);
}

// Nearest resolved tickets. Returns every match with its score, plus which
// ones clear the similarity threshold; callers log scores to tune it.
export async function similarResolvedTickets(ticket) {
  const vector = await embedQuery(ticketQueryText(ticket));
  const result = await getIndex().namespace(CLOSED_TICKETS_NAMESPACE).query({
    vector,
    topK: 3,
    includeMetadata: true,
  });
  const candidates = await Promise.all(
    (result.matches ?? [])
      .filter((m) => m.metadata?.mongoId !== ticket.id) // a ticket is not its own precedent
      .map(async (m) => {
        const past = await Ticket.findById(m.metadata.mongoId).lean();
        return past
          ? {
              score: m.score,
              ticketId: past._id,
              subject: past.subject,
              resolutionSummary: past.resolutionSummary,
              resolvedAt: past.updatedAt,
            }
          : null;
      })
  );
  const scored = candidates.filter(Boolean);
  return {
    threshold: config.similarityThreshold,
    matches: scored.filter((c) => c.score >= config.similarityThreshold),
    bestScore: scored[0]?.score ?? null,
  };
}

// Index a resolved ticket's problem + resolution into the closed-tickets
// namespace so future tickets can find it as a precedent.
export async function indexResolvedTicket(ticket) {
  const { embedPassages } = await import('./embeddings.js');
  const passage = `${ticketQueryText(ticket)}\n\nResolution: ${ticket.resolutionSummary}`;
  const [values] = await embedPassages([passage]);
  await getIndex().namespace(CLOSED_TICKETS_NAMESPACE).upsert([
    {
      id: ticket.id,
      values,
      metadata: {
        mongoId: ticket.id,
        subject: ticket.subject,
        resolutionSummary: ticket.resolutionSummary,
      },
    },
  ]);
}
