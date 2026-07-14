import { Pinecone } from '@pinecone-database/pinecone';
import config from '../config.js';

// One index, two namespaces: KB articles and closed-ticket resolutions stay separate.
export const KB_NAMESPACE = 'kb-articles';
export const CLOSED_TICKETS_NAMESPACE = 'closed-tickets';

let client;

export function getPinecone() {
  if (!client) {
    client = new Pinecone({ apiKey: config.pineconeApiKey });
  }
  return client;
}

export function getIndex() {
  const pc = getPinecone();
  return config.pineconeHost
    ? pc.index(config.pineconeIndex, config.pineconeHost)
    : pc.index(config.pineconeIndex);
}
