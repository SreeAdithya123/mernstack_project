import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// server/.env wins over repo-root .env; real environment variables win over both
// (dotenv never overrides variables that are already set).
dotenv.config({ path: path.join(serverDir, '.env'), quiet: true });
dotenv.config({ path: path.join(serverDir, '..', '.env'), quiet: true });

const config = {
  port: Number(process.env.PORT) || 5001,

  mongodbUri: process.env.MONGODB_URI,
  mongodbDb: process.env.MONGODB_DB || 'smartsupport',

  // LLM for classification / drafting / summarization: OpenRouter chat completions.
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free',

  // Embeddings: Pinecone Inference hosted model (OpenRouter has no embeddings endpoint).
  embedModel: process.env.EMBED_MODEL || 'llama-text-embed-v2',
  embedDimension: Number(process.env.EMBED_DIMENSION) || 1024,

  pineconeApiKey: process.env.PINECONE_API_KEY,
  pineconeIndex: process.env.PINECONE_INDEX || 'smartsupport',
  pineconeHost: process.env.PINECONE_HOST || undefined,
};

export const REQUIRED_ENV = {
  mongo: ['MONGODB_URI'],
  llm: ['OPENROUTER_API_KEY'],
  pinecone: ['PINECONE_API_KEY'],
};

export function missingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

export default config;
