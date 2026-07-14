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

  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
  geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  embedDimension: Number(process.env.EMBED_DIMENSION) || 768,

  pineconeApiKey: process.env.PINECONE_API_KEY,
  pineconeIndex: process.env.PINECONE_INDEX || 'smartsupport',
  pineconeHost: process.env.PINECONE_HOST || undefined,
};

export const REQUIRED_ENV = {
  mongo: ['MONGODB_URI'],
  gemini: ['GEMINI_API_KEY'],
  pinecone: ['PINECONE_API_KEY'],
};

export function missingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

export default config;
