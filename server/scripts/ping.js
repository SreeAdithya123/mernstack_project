// Phase 0 verification: ping MongoDB, Gemini (generation + embeddings), and
// Pinecone with the configured credentials and print PASS/FAIL for each.
import config, { missingEnv, REQUIRED_ENV } from '../src/config.js';

const results = [];

async function check(name, envNames, fn) {
  const missing = missingEnv(envNames);
  if (missing.length) {
    results.push({ name, ok: false, detail: `missing credential: ${missing.join(', ')} is not set` });
    return;
  }
  try {
    results.push({ name, ok: true, detail: await fn() });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}

// Imports happen lazily so a missing credential for one service can't crash the others' checks.
await check('MongoDB', REQUIRED_ENV.mongo, async () => {
  const { connectDB } = await import('../src/db.js');
  const { default: mongoose } = await import('mongoose');
  const conn = await connectDB();
  await conn.db.admin().command({ ping: 1 });
  await mongoose.disconnect();
  return `connected, ping ok (db: ${config.mongodbDb})`;
});

await check('Gemini generate', REQUIRED_ENV.gemini, async () => {
  const { generateText } = await import('../src/lib/gemini.js');
  const text = await generateText('Reply with exactly one word: PONG');
  return `${config.geminiChatModel} replied: ${String(text).trim().slice(0, 40)}`;
});

await check('Gemini embeddings', REQUIRED_ENV.gemini, async () => {
  const { embedText } = await import('../src/lib/gemini.js');
  const vector = await embedText('connectivity test');
  return `${config.geminiEmbedModel} returned a ${vector.length}-dim vector`;
});

await check('Pinecone', REQUIRED_ENV.pinecone, async () => {
  const { getPinecone } = await import('../src/lib/pinecone.js');
  const { indexes = [] } = await getPinecone().listIndexes();
  const target = indexes.find((i) => i.name === config.pineconeIndex);
  const targetNote = target
    ? `index "${config.pineconeIndex}" exists (dim ${target.dimension}, metric ${target.metric})`
    : `index "${config.pineconeIndex}" not found yet — the Phase 1 seed script will create it`;
  return `authenticated (${indexes.length} index(es) visible); ${targetNote}`;
});

let allOk = true;
console.log('\nSmartSupport connectivity check');
console.log('-'.repeat(72));
for (const r of results) {
  if (!r.ok) allOk = false;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(18)} ${r.detail}`);
}
console.log('-'.repeat(72));
console.log(allOk ? 'All services reachable.' : 'One or more services failed (see above).');
process.exit(allOk ? 0 : 1);
