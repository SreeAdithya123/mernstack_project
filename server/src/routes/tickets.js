import { Router } from 'express';
import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import { classifyTicket } from '../lib/triage.js';

const router = Router();

const asString = (v) => (typeof v === 'string' ? v.trim() : '');

async function findTicketOr404(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'ticket not found' });
    return null;
  }
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) {
    res.status(404).json({ error: 'ticket not found' });
    return null;
  }
  return ticket;
}

// Create a ticket (end-user submission) and auto-triage it. The ticket is
// persisted even if classification fails; the response says so.
router.post('/', async (req, res) => {
  const name = asString(req.body.name);
  const email = asString(req.body.email);
  const subject = asString(req.body.subject);
  const message = asString(req.body.message);
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'name, email, subject and message are all required' });
  }

  const ticket = await Ticket.create({
    submitterName: name,
    submitterEmail: email,
    subject,
    messages: [{ author: 'user', text: message }],
  });

  let classificationError;
  try {
    Object.assign(ticket, await classifyTicket({ subject, text: message }));
    await ticket.save();
  } catch (err) {
    classificationError = err.message;
    console.error(`ticket ${ticket.id}: ${err.message}`);
  }

  res.status(201).json({ ticket, ...(classificationError && { classificationError }) });
});

router.get('/', async (req, res) => {
  const tickets = await Ticket.find().sort({ createdAt: -1 }).lean();
  res.json(tickets);
});

router.get('/:id', async (req, res) => {
  const ticket = await findTicketOr404(req, res);
  if (ticket) res.json(ticket);
});

// Append a message to the thread (agent reply or user follow-up).
router.post('/:id/messages', async (req, res) => {
  const author = asString(req.body.author);
  const text = asString(req.body.text);
  if (!['user', 'agent'].includes(author) || !text) {
    return res.status(400).json({ error: 'author ("user" or "agent") and text are required' });
  }
  const ticket = await findTicketOr404(req, res);
  if (!ticket) return;
  ticket.messages.push({ author, text });
  await ticket.save();
  res.json(ticket);
});

// Update status; a resolution summary can be recorded when resolving.
router.patch('/:id', async (req, res) => {
  const ticket = await findTicketOr404(req, res);
  if (!ticket) return;
  if (req.body.status !== undefined) ticket.status = req.body.status;
  if (req.body.resolutionSummary !== undefined) {
    ticket.resolutionSummary = asString(req.body.resolutionSummary) || null;
  }
  try {
    await ticket.save();
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    throw err;
  }
  res.json(ticket);
});

export default router;
