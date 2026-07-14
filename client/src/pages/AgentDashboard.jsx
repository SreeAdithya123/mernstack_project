import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { SentimentChip, PriorityChip, CategoryChip, StatusBadge } from '../components/Chips.jsx';
import SolverPanel from '../components/SolverPanel.jsx';

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function AgentDashboard() {
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const selected = tickets.find((t) => t._id === selectedId);

  const refresh = useCallback(async () => {
    try {
      setTickets(await api.listTickets());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const replaceTicket = (ticket) =>
    setTickets((ts) => ts.map((t) => (t._id === ticket._id ? ticket : t)));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <aside>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Tickets</h1>
          <button
            onClick={refresh}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t._id}>
              <button
                onClick={() => setSelectedId(t._id)}
                className={`w-full rounded-lg border p-3 text-left ${
                  t._id === selectedId
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">{t.subject}</p>
                  <StatusBadge value={t.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {t.submitterName} · {timeAgo(t.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <PriorityChip value={t.priority} />
                  <SentimentChip value={t.sentiment} />
                  <CategoryChip value={t.category} />
                </div>
              </button>
            </li>
          ))}
          {tickets.length === 0 && !error && (
            <p className="text-sm text-slate-400">No tickets yet.</p>
          )}
        </ul>
      </aside>

      {selected ? (
        <TicketDetail key={selected._id} ticket={selected} onChange={replaceTicket} />
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
          Select a ticket to open the solver.
        </div>
      )}
    </div>
  );
}

function TicketDetail({ ticket, onChange }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState(ticket.resolutionSummary ?? '');

  const act = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = () =>
    act(async () => {
      const updated = await api.addMessage(ticket._id, { author: 'agent', text: reply });
      onChange(updated);
      setReply('');
    });

  const setStatus = (status) =>
    act(async () => {
      if (status === 'Resolved') {
        setResolving(true);
        return;
      }
      onChange(await api.updateTicket(ticket._id, { status }));
    });

  const confirmResolve = () =>
    act(async () => {
      const updated = await api.updateTicket(ticket._id, {
        status: 'Resolved',
        resolutionSummary,
      });
      onChange(updated);
      setResolving(false);
      if (updated.indexWarning) setActionError(updated.indexWarning);
    });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_minmax(300px,380px)]">
      <div className="rounded-lg border border-slate-200 bg-white">
        <header className="border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{ticket.subject}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {ticket.submitterName} &lt;{ticket.submitterEmail}&gt;
              </p>
            </div>
            <select
              value={ticket.status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={busy}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              {['Open', 'In Progress', 'Resolved'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <PriorityChip value={ticket.priority} />
            <SentimentChip value={ticket.sentiment} />
            <CategoryChip value={ticket.category} />
            <StatusBadge value={ticket.status} />
          </div>
          {resolving && (
            <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3">
              <p className="text-xs font-medium text-green-900">
                Resolution summary (indexed so future similar tickets find this fix):
              </p>
              <textarea
                rows={3}
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                className="mt-2 w-full rounded-md border border-green-300 px-2 py-1.5 text-sm"
                placeholder="What was the problem and how was it fixed?"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={confirmResolve}
                  disabled={busy || !resolutionSummary.trim()}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Mark resolved
                </button>
                <button
                  onClick={() => setResolving(false)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {ticket.resolutionSummary && !resolving && (
            <p className="mt-2 rounded-md bg-green-50 p-2 text-xs text-green-900">
              <span className="font-medium">Resolution:</span> {ticket.resolutionSummary}
            </p>
          )}
        </header>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto p-4">
          {ticket.messages.map((m, i) => (
            <div key={i} className={`flex ${m.author === 'agent' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
                  m.author === 'agent' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'
                }`}
              >
                <p className="mb-1 text-[11px] opacity-70">
                  {m.author === 'agent' ? 'Agent' : ticket.submitterName} · {timeAgo(m.timestamp)}
                </p>
                {m.text}
              </div>
            </div>
          ))}
        </div>

        <footer className="border-t border-slate-200 p-4">
          <textarea
            rows={5}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply, or let the AI draft one from the KB…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {actionError && <p className="mt-1 text-xs text-red-600">{actionError}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={sendReply}
              disabled={busy || !reply.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Send reply
            </button>
          </div>
        </footer>
      </div>

      <SolverPanel ticket={ticket} onDraft={setReply} />
    </div>
  );
}
