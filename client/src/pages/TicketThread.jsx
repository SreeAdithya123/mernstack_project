import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { tickets } from '../lib/tickets.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SentimentChip, PriorityChip, CategoryChip, StatusBadge } from '../components/Chips.jsx';

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function TicketThread() {
  const { id } = useParams();
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([tickets.get(id), tickets.messages(id)]).then(
      ([t, m]) => {
        if (cancelled) return;
        setTicket(t);
        setMessages(m);
      },
      (err) => !cancelled && setError(err.message)
    );

    // Realtime: new agent replies show up without a manual refresh.
    const channel = supabase
      .channel(`ticket-messages-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${id}` },
        (payload) => {
          if (payload.new.internal_only) return;
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id]);

  const sendReply = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const message = await tickets.reply(id, user.id, reply);
      setMessages((prev) => [...prev, message]);
      setReply('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !ticket) return <p className="text-sm text-red-600">{error}</p>;
  if (!ticket) return <p className="text-sm text-ink-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-cream-400 bg-cream-50 shadow-sm">
      <header className="border-b border-cream-300 p-4">
        <h1 className="font-serif text-lg font-semibold text-ink-900">{ticket.subject}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge value={ticket.status} />
          <PriorityChip value={ticket.priority} />
          <SentimentChip value={ticket.sentiment} />
          <CategoryChip value={ticket.category} />
        </div>
        {ticket.resolution_summary && (
          <p className="mt-2 rounded-lg bg-clay-50 p-2 text-xs text-clay-700">
            <span className="font-medium">Resolution:</span> {ticket.resolution_summary}
          </p>
        )}
      </header>

      <div className="max-h-[50vh] space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender_id === user.id ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line ${
                m.sender_id === user.id ? 'bg-clay-500 text-white' : 'bg-cream-200 text-ink-800'
              }`}
            >
              <p className="mb-1 text-[11px] opacity-70">
                {m.sender_id === user.id ? 'You' : 'Support agent'} · {timeAgo(m.created_at)}
              </p>
              {m.body}
            </div>
          </div>
        ))}
        {messages.length === 0 && <p className="text-sm text-ink-400">No messages yet.</p>}
      </div>

      {ticket.status !== 'resolved' ? (
        <form onSubmit={sendReply} className="border-t border-cream-300 p-4">
          <textarea
            rows={3}
            required
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Add more detail or reply to the agent…"
            className="w-full rounded-lg border border-cream-400 bg-cream-50 px-3 py-2 text-sm text-ink-800 focus:border-clay-500 focus:outline-none"
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-clay-500 px-4 py-2 text-sm font-medium text-white hover:bg-clay-600 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      ) : (
        <p className="border-t border-cream-300 p-4 text-xs text-ink-400">
          This ticket is resolved. Submit a new ticket if the issue comes back.
        </p>
      )}
    </div>
  );
}
