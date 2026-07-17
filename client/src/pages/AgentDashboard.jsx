import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { tickets } from '../lib/tickets.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SentimentChip, PriorityChip, CategoryChip, StatusBadge, LanguageChip, AutoClosedBadge } from '../components/Chips.jsx';
import SolverPanel from '../components/SolverPanel.jsx';

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function AgentDashboard() {
  const { id: selectedId } = useParams();
  const navigate = useNavigate();
  const [ticketList, setTicketList] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setTicketList(await tickets.listAll());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const replaceTicket = (updated) =>
    setTicketList((ts) => ts.map((t) => (t.id === updated.id ? updated : t)));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <aside>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-serif text-lg font-semibold text-ink-900">Tickets</h1>
          <button
            onClick={refresh}
            className="rounded-full border border-cream-400 px-3 py-1 text-xs text-ink-600 hover:bg-cream-200"
          >
            Refresh
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <ul className="space-y-2">
          {ticketList.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => navigate(`/agent/tickets/${t.id}`)}
                className={`w-full rounded-xl border p-3 text-left shadow-sm transition-colors ${
                  t.id === selectedId
                    ? 'border-clay-400 bg-clay-50'
                    : 'border-cream-400 bg-cream-50 hover:border-clay-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink-800">{t.subject_translated ?? t.subject}</p>
                  <StatusBadge value={t.status} />
                </div>
                <p className="mt-1 text-xs text-ink-500">{timeAgo(t.created_at)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <PriorityChip value={t.priority} />
                  <SentimentChip value={t.sentiment} />
                  <CategoryChip value={t.category} />
                  <LanguageChip value={t.detected_language} />
                  <AutoClosedBadge show={t.auto_closed_by_ai} />
                </div>
              </button>
            </li>
          ))}
          {ticketList.length === 0 && !error && <p className="text-sm text-ink-400">No tickets yet.</p>}
        </ul>
      </aside>

      {selectedId ? (
        <TicketDetail key={selectedId} ticketId={selectedId} onTicketChange={replaceTicket} />
      ) : (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-cream-400 text-sm text-ink-400">
          Select a ticket to open the solver.
        </div>
      )}
    </div>
  );
}

function TicketDetail({ ticketId, onTicketChange }) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [draftMessageId, setDraftMessageId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [showOriginal, setShowOriginal] = useState(() => new Set());

  const loadTicket = useCallback(async () => {
    const t = await tickets.get(ticketId);
    setTicket(t);
    setResolutionSummary((prev) => prev || t.resolution_summary || '');
    onTicketChange(t);
  }, [ticketId, onTicketChange]);

  const loadMessages = useCallback(async () => {
    const rows = await tickets.messages(ticketId, { includeInternal: true });
    setMessages(rows);
    const pendingDraft = rows.find((m) => m.is_ai_draft && m.internal_only);
    if (pendingDraft) {
      setDraftMessageId(pendingDraft.id);
      setReply(pendingDraft.body);
    }
  }, [ticketId]);

  useEffect(() => {
    let cancelled = false;
    tickets.get(ticketId).then((t) => {
      if (cancelled) return;
      setTicket(t);
      setResolutionSummary(t.resolution_summary ?? '');
      onTicketChange(t);
    });
    loadMessages();

    // A new message can also trigger a server-side auto-close or translation
    // (subject_translated/detected_language), so refetch the ticket row too -
    // this is how the agent sees an auto-close land live without polling.
    const channel = supabase
      .channel(`agent-ticket-messages-${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${ticketId}` },
        () => {
          loadMessages();
          loadTicket();
        }
      )
      .on(
        // Translation (body_translated) lands as an UPDATE shortly after the
        // triggering insert, not as part of it.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${ticketId}` },
        () => loadMessages()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
        (payload) => {
          setTicket(payload.new);
          onTicketChange(payload.new);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [ticketId, loadMessages, loadTicket]);

  const toggleOriginal = (messageId) =>
    setShowOriginal((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

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
      if (draftMessageId) {
        await tickets.sendDraft(draftMessageId, reply);
        setDraftMessageId(null);
      } else {
        await tickets.reply(ticketId, user.id, reply);
      }
      setReply('');
      await loadMessages();
    });

  const setStatus = (status) =>
    act(async () => {
      if (status === 'resolved') {
        setResolving(true);
        return;
      }
      const updated = await tickets.updateStatus(ticketId, { status });
      setTicket(updated);
      onTicketChange(updated);
    });

  const confirmResolve = () =>
    act(async () => {
      const updated = await tickets.updateStatus(ticketId, { status: 'resolved', resolution_summary: resolutionSummary });
      setTicket(updated);
      onTicketChange(updated);
      setResolving(false);
    });

  if (!ticket) return <p className="text-sm text-ink-400">Loading…</p>;

  const visibleMessages = messages.filter((m) => !(m.is_ai_draft && m.internal_only));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_minmax(300px,380px)]">
      <div className="rounded-2xl border border-cream-400 bg-cream-50 shadow-sm">
        <header className="border-b border-cream-300 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-serif text-lg font-semibold text-ink-900">{ticket.subject_translated ?? ticket.subject}</h2>
            <select
              value={ticket.status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={busy}
              className="rounded-lg border border-cream-400 bg-cream-50 px-2 py-1 text-xs text-ink-700"
            >
              {['open', 'in_progress', 'resolved'].map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <PriorityChip value={ticket.priority} />
            <SentimentChip value={ticket.sentiment} />
            <CategoryChip value={ticket.category} />
            <StatusBadge value={ticket.status} />
            <LanguageChip value={ticket.detected_language} />
            <AutoClosedBadge show={ticket.auto_closed_by_ai} />
          </div>
          {resolving && (
            <div className="mt-3 rounded-lg border border-clay-100 bg-clay-50 p-3">
              <p className="text-xs font-medium text-clay-700">
                Resolution summary (indexed so future similar tickets find this fix):
              </p>
              <textarea
                rows={3}
                value={resolutionSummary}
                onChange={(e) => setResolutionSummary(e.target.value)}
                className="mt-2 w-full rounded-lg border border-clay-100 bg-cream-50 px-2 py-1.5 text-sm"
                placeholder="What was the problem and how was it fixed?"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={confirmResolve}
                  disabled={busy || !resolutionSummary.trim()}
                  className="rounded-full bg-clay-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-clay-600 disabled:opacity-50"
                >
                  Mark resolved
                </button>
                <button
                  onClick={() => setResolving(false)}
                  className="rounded-full border border-cream-400 px-3 py-1.5 text-xs text-ink-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {ticket.resolution_summary && !resolving && (
            <p className="mt-2 rounded-lg bg-clay-50 p-2 text-xs text-clay-700">
              <span className="font-medium">Resolution:</span> {ticket.resolution_summary}
            </p>
          )}
        </header>

        <div className="max-h-[45vh] space-y-3 overflow-y-auto p-4">
          {visibleMessages.map((m) => {
            const isCustomer = m.sender_id === ticket.customer_id;
            const original = showOriginal.has(m.id);
            // Agent's dashboard always works in English by default. Customer
            // messages: body_translated *is* the English version. Staff
            // messages: body *is* English and body_translated is the
            // customer-language version sent to them - so the "other"
            // language is body_translated either way.
            const englishText = isCustomer ? (m.body_translated ?? m.body) : m.body;
            const otherLangText = isCustomer ? m.body : m.body_translated;
            const displayBody = original && otherLangText ? otherLangText : englishText;
            return (
              <div key={m.id} className={`flex ${!isCustomer ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line ${
                    !isCustomer ? 'bg-clay-500 text-white' : 'bg-cream-200 text-ink-800'
                  }`}
                >
                  <p className="mb-1 text-[11px] opacity-70">
                    {!isCustomer ? 'Agent' : 'Customer'} · {timeAgo(m.created_at)}
                    {m.is_voice_transcript ? ' · 🎤 voice' : ''}
                  </p>
                  {displayBody}
                  {otherLangText && (
                    <button
                      type="button"
                      onClick={() => toggleOriginal(m.id)}
                      className="mt-1 block text-[11px] underline opacity-70 hover:opacity-100"
                    >
                      {original ? 'Show English' : `Show ${ticket.detected_language} translation`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="border-t border-cream-300 p-4">
          {draftMessageId && (
            <p className="mb-1.5 text-xs font-medium text-clay-700">AI draft below — edit before sending.</p>
          )}
          <textarea
            rows={5}
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              if (draftMessageId) setDraftMessageId(null);
            }}
            placeholder="Write a reply, or let the AI draft one from the KB…"
            className="w-full rounded-lg border border-cream-400 bg-cream-50 px-3 py-2 text-sm text-ink-800 focus:border-clay-500 focus:outline-none"
          />
          {actionError && <p className="mt-1 text-xs text-red-600">{actionError}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={sendReply}
              disabled={busy || !reply.trim()}
              className="rounded-full bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600 disabled:opacity-50"
            >
              Send reply
            </button>
          </div>
        </footer>
      </div>

      <SolverPanel
        ticket={ticket}
        onSummaryChange={(summary) => setTicket((t) => ({ ...t, summary }))}
        onDraft={(draftRow) => {
          setDraftMessageId(draftRow.id);
          setReply(draftRow.body);
        }}
      />
    </div>
  );
}
