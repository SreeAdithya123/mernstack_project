// Phase 0 verification: ping MongoDB, OpenRouter (LLM), and Pinecone
// (inference + index control plane) with the configured credentials and
// print PASS/FAIL for each.
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
    results.push({ name, ok: false, detail: String(err.message).replace(/\s+/g, ' ').slice(0, 160) });
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

await check('OpenRouter LLM', REQUIRED_ENV.llm, async () => {
  const { generateText } = await import('../src/lib/llm.js');
  const text = await generateText('Reply with exactly one word: PONG');
  return `${config.openrouterModel} replied: ${String(text).trim().slice(0, 40)}`;
});

await check('Pinecone embeddings', REQUIRED_ENV.pinecone, async () => {
  const { embedQuery } = await import('../src/lib/embeddings.js');
  const vector = await embedQuery('connectivity test');
  return `${config.embedModel} returned a ${vector.length}-dim vector`;
});

await check('Pinecone index', REQUIRED_ENV.pinecone, async () => {
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
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(20)} ${r.detail}`);
}
console.log('-'.repeat(72));
console.log(allOk ? 'All services reachable.' : 'One or more services failed (see above).');
process.exit(allOk ? 0 : 1);
