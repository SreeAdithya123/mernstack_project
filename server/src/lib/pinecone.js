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

// Create the index if it doesn't exist; refuse to run against one whose
// dimension doesn't match the embedding model.
export async function ensureIndex() {
  const pc = getPinecone();
  const { indexes = [] } = await pc.listIndexes();
  const existing = indexes.find((i) => i.name === config.pineconeIndex);
  if (existing) {
    if (existing.dimension !== config.embedDimension) {
      throw new Error(
        `Pinecone index "${config.pineconeIndex}" has dimension ${existing.dimension}, ` +
          `but EMBED_DIMENSION is ${config.embedDimension}. Fix one of them.`
      );
    }
    return existing;
  }
  console.log(`Creating Pinecone index "${config.pineconeIndex}" (serverless aws/us-east-1, cosine, dim ${config.embedDimension})...`);
  await pc.createIndex({
    name: config.pineconeIndex,
    dimension: config.embedDimension,
    metric: 'cosine',
    spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
    waitUntilReady: true,
  });
  return pc.describeIndex(config.pineconeIndex);
}
