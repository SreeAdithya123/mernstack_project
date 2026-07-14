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

  // LLM for classification / drafting / summarization: OpenRouter chat completions
  // primary, Gemini API fallback when OpenRouter fails (quota, rate limit, blocked).
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemma-4-31b-it',

  // Embeddings: Pinecone Inference hosted model (OpenRouter has no embeddings endpoint).
  embedModel: process.env.EMBED_MODEL || 'llama-text-embed-v2',
  embedDimension: Number(process.env.EMBED_DIMENSION) || 1024,

  pineconeApiKey: process.env.PINECONE_API_KEY,
  pineconeIndex: process.env.PINECONE_INDEX || 'smartsupport',
  pineconeHost: process.env.PINECONE_HOST || undefined,

  // Cosine score above which a past resolved ticket counts as "the same
  // issue". Starting point 0.80 per spec; tune against real scores (Phase 5/8
  // verification logs them).
  similarityThreshold: Number(process.env.SIMILARITY_THRESHOLD) || 0.8,
};

export const REQUIRED_ENV = {
  mongo: ['MONGODB_URI'],
  // Either LLM key satisfies the requirement; both configured means failover.
  llm: [['OPENROUTER_API_KEY', 'GEMINI_API_KEY']],
  pinecone: ['PINECONE_API_KEY'],
};

// Each entry is an env var name (required) or an array of names (at least one required).
export function missingEnv(names) {
  return names
    .filter((entry) =>
      Array.isArray(entry) ? !entry.some((name) => process.env[name]) : !process.env[entry]
    )
    .map((entry) => (Array.isArray(entry) ? entry.join(' or ') : entry));
}

export default config;
