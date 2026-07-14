import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    author: { type: String, enum: ['user', 'agent'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    submitterName: { type: String, required: true, trim: true },
    submitterEmail: { type: String, required: true, trim: true, lowercase: true },
    subject: { type: String, required: true, trim: true },
    messages: { type: [messageSchema], required: true },
    status: { type: String, enum: ['Open', 'In Progress', 'Resolved'], default: 'Open' },

    // Set by auto-triage (Phase 2); null until classification runs.
    sentiment: { type: String, enum: ['Positive', 'Neutral', 'Negative', 'Angry'], default: null },
    priority: { type: String, enum: ['High', 'Medium', 'Low'], default: null },
    category: { type: String, enum: ['Billing', 'Technical', 'Feature Request'], default: null },

    // Set by summarization (Phase 6).
    summary: { type: String, default: null },
    // Set when an agent resolves the ticket; embedded into the closed-tickets
    // namespace for similar-issue detection (Phase 5).
    resolutionSummary: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Ticket', ticketSchema);
