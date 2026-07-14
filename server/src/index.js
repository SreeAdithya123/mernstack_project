import express from 'express';
import cors from 'cors';
import config, { missingEnv, REQUIRED_ENV } from './config.js';
import { connectDB } from './db.js';
import ticketsRouter from './routes/tickets.js';

const missing = missingEnv(Object.values(REQUIRED_ENV).flat());
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy server/.env.example to server/.env, fill it in, and retry.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use('/api/tickets', ticketsRouter);

// Express 5 forwards rejected async handlers here automatically.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

await connectDB();
console.log(`MongoDB connected (db: ${config.mongodbDb})`);

app.listen(config.port, () => {
  console.log(`SmartSupport API listening on http://localhost:${config.port}`);
});
