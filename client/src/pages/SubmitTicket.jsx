import { useState } from 'react';
import { Link } from 'react-router-dom';
import { tickets } from '../lib/tickets.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SentimentChip, PriorityChip, CategoryChip } from '../components/Chips.jsx';
import VoiceNote from '../components/VoiceNote.jsx';

const field =
  'w-full rounded-lg border border-cream-400 bg-cream-50 px-3 py-2 text-sm text-ink-800 focus:border-clay-500 focus:outline-none';

export default function SubmitTicket() {
  const { user } = useAuth();
  const [form, setForm] = useState({ subject: '', message: '' });
  const [usedVoice, setUsedVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const onTranscript = (text) => {
    setUsedVoice(true);
    setForm((f) => ({ ...f, message: f.message ? `${f.message}\n\n${text}` : text }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ticket, classificationError } = await tickets.create({
        customerId: user.id,
        subject: form.subject,
        message: form.message,
        isVoiceTranscript: usedVoice,
      });
      setCreated({ ticket, classificationError });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const t = created.ticket;
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-cream-400 bg-cream-50 p-6 shadow-sm">
        <h1 className="font-serif text-xl font-semibold text-clay-600">Ticket received</h1>
        <p className="mt-2 text-sm text-ink-600">
          Your ticket is in the queue. Track it any time from{' '}
          <Link to={`/tickets/${t.id}`} className="text-clay-600 hover:underline">
            My Tickets
          </Link>
          .
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-500">Auto-triage:</span>
          <SentimentChip value={t.sentiment} />
          <PriorityChip value={t.priority} />
          <CategoryChip value={t.category} />
          {created.classificationError && (
            <span className="text-xs text-amber-700">triage pending: {created.classificationError}</span>
          )}
        </div>
        <button
          onClick={() => {
            setCreated(null);
            setForm({ subject: '', message: '' });
            setUsedVoice(false);
          }}
          className="mt-6 rounded-full bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600"
        >
          Submit another ticket
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-cream-400 bg-cream-50 p-6 shadow-sm">
      <h1 className="font-serif text-xl font-semibold text-ink-900">Submit a ticket</h1>
      <p className="mt-1 text-sm text-ink-500">Tell us what's wrong and we'll get on it.</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm">
          <span className="text-ink-600">Subject</span>
          <input required value={form.subject} onChange={set('subject')} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-600">What's the problem?</span>
          <textarea
            required
            rows={6}
            value={form.message}
            onChange={(e) => {
              setUsedVoice(false);
              set('message')(e);
            }}
            className={`mt-1 ${field}`}
          />
        </label>
        <div>
          <p className="mb-1.5 text-xs text-ink-500">Or describe it by voice — we'll transcribe it into the box above:</p>
          <VoiceNote onTranscript={onTranscript} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600 disabled:opacity-50"
        >
          {busy ? 'Submitting — AI triage takes a few seconds…' : 'Submit ticket'}
        </button>
      </form>
    </div>
  );
}
