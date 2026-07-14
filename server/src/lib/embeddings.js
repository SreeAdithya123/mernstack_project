import config from '../config.js';
import { getPinecone } from './pinecone.js';

async function embed(texts, inputType) {
  const res = await getPinecone().inference.embed(config.embedModel, texts, {
    inputType,
    truncate: 'END',
  });
  const data = res.data ?? res;
  return texts.map((_, i) => {
    const values = data[i]?.values;
    if (!values || values.length !== config.embedDimension) {
      throw new Error(
        `Unexpected embedding for input ${i}: got ${values ? values.length : 'no'} values, expected ${config.embedDimension}`
      );
    }
    return values;
  });
}

// Documents being indexed embed as "passage"; search text embeds as "query".
export function embedPassages(texts) {
  return embed(texts, 'passage');
}

export async function embedQuery(text) {
  const [values] = await embed([text], 'query');
  return values;
}
