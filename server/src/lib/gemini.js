import { GoogleGenAI } from '@google/genai';
import config from './config.js';

let client;

export function getGenAI() {
  if (!client) {
    client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return client;
}

export async function generateText(prompt, generationConfig = {}) {
  const res = await getGenAI().models.generateContent({
    model: config.geminiChatModel,
    contents: prompt,
    config: generationConfig,
  });
  return res.text;
}

export async function embedText(text) {
  const res = await getGenAI().models.embedContent({
    model: config.geminiEmbedModel,
    contents: text,
    config: { outputDimensionality: config.embedDimension },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values || values.length !== config.embedDimension) {
    throw new Error(
      `Unexpected embedding response: got ${values ? values.length : 'no'} values, expected ${config.embedDimension}`
    );
  }
  return values;
}
