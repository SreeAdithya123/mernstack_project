import { useState } from 'react';
import { Link } from 'react-router-dom';
import { tickets } from '../lib/tickets.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SentimentChip, PriorityChip, CategoryChip } from '../components/Chips.jsx';

const field = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

export default function SubmitTicket() {
  const { user } = useAuth();
  const [form, setForm] = useState({ subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ticket, classificationError } = await tickets.create({
        customerId: user.id,
        subject: form.subject,
        message: form.message,
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
      <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-green-700">Ticket received</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your ticket is in the queue. Track it any time from{' '}
          <Link to={`/tickets/${t.id}`} className="text-indigo-700 hover:underline">
            My Tickets
          </Link>
          .
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Auto-triage:</span>
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
          }}
          className="mt-6 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Submit another ticket
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Submit a ticket</h1>
      <p className="mt-1 text-sm text-slate-500">Tell us what's wrong and we'll get on it.</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm">
          <span className="text-slate-600">Subject</span>
          <input required value={form.subject} onChange={set('subject')} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">What's the problem?</span>
          <textarea required rows={6} value={form.message} onChange={set('message')} className={`mt-1 ${field}`} />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Submitting — AI triage takes a few seconds…' : 'Submit ticket'}
        </button>
      </form>
    </div>
  );
}
