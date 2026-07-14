// Manual semantic search against the KB namespace, for verification:
//   node scripts/searchKB.js "I can't log in"
import mongoose from 'mongoose';
import { connectDB } from '../src/db.js';
import KBArticle from '../src/models/KBArticle.js';
import { embedQuery } from '../src/lib/embeddings.js';
import { getIndex, KB_NAMESPACE } from '../src/lib/pinecone.js';

const query = process.argv[2];
if (!query) {
  console.error('Usage: node scripts/searchKB.js "<query text>"');
  process.exit(1);
}

await connectDB();
const vector = await embedQuery(query);
const res = await getIndex().namespace(KB_NAMESPACE).query({
  vector,
  topK: 3,
  includeMetadata: true,
});

console.log(`Top ${res.matches.length} KB matches for: "${query}"\n`);
for (const [i, m] of res.matches.entries()) {
  const article = await KBArticle.findById(m.metadata.mongoId).lean();
  console.log(`${i + 1}. [score ${m.score.toFixed(4)}] ${m.metadata.title} (${m.metadata.category})`);
  console.log(`   ${article ? article.body.slice(0, 100).replace(/\n/g, ' ') : 'ARTICLE MISSING IN MONGO'}...\n`);
}
await mongoose.disconnect();
