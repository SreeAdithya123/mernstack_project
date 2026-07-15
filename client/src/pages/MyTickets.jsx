import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { tickets } from '../lib/tickets.js';
import { SentimentChip, PriorityChip, CategoryChip, StatusBadge } from '../components/Chips.jsx';

export default function MyTickets() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    tickets.listMine().then(
      (data) => setState({ status: 'done', data }),
      (err) => setState({ status: 'error', error: err.message })
    );
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">My tickets</h1>
        <Link to="/submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
          Submit a new ticket
        </Link>
      </div>
      {state.status === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}
      {state.status === 'error' && <p className="text-sm text-red-600">{state.error}</p>}
      {state.status === 'done' && (
        <ul className="space-y-2">
          {state.data.map((t) => (
            <li key={t.id}>
              <Link
                to={`/tickets/${t.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-indigo-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">{t.subject}</p>
                  <StatusBadge value={t.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <PriorityChip value={t.priority} />
                  <SentimentChip value={t.sentiment} />
                  <CategoryChip value={t.category} />
                </div>
              </Link>
            </li>
          ))}
          {state.data.length === 0 && <p className="text-sm text-slate-400">No tickets yet.</p>}
        </ul>
      )}
    </div>
  );
}
