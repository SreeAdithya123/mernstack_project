import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function Card({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const ErrorNote = ({ error }) => <p className="text-xs text-red-600">{error}</p>;
const Loading = () => <p className="text-xs text-slate-400">Loading…</p>;

// AI assistance sidebar: handoff summary, semantic KB matches, and
// similar past resolved tickets for the selected ticket.
export default function SolverPanel({ ticket, onDraft }) {
  const [kb, setKb] = useState({ state: 'loading' });
  const [similar, setSimilar] = useState({ state: 'loading' });
  const [summary, setSummary] = useState({ state: 'idle', text: ticket.summary });
  const [drafting, setDrafting] = useState(false);
  const [draftInfo, setDraftInfo] = useState(null);

  useEffect(() => {
    setKb({ state: 'loading' });
    setSimilar({ state: 'loading' });
    setSummary({ state: 'idle', text: ticket.summary });
    setDraftInfo(null);
    api.kbMatches(ticket._id).then(
      (data) => setKb({ state: 'done', data }),
      (err) => setKb({ state: 'error', error: err.message })
    );
    api.similar(ticket._id).then(
      (data) => setSimilar({ state: 'done', data }),
      (err) => setSimilar({ state: 'error', error: err.message })
    );
  }, [ticket._id]);

  const generateSummary = async () => {
    setSummary({ state: 'loading', text: summary.text });
    try {
      const { summary: text } = await api.summarize(ticket._id);
      setSummary({ state: 'done', text });
    } catch (err) {
      setSummary({ state: 'error', text: summary.text, error: err.message });
    }
  };

  const generateDraft = async () => {
    setDrafting(true);
    setDraftInfo(null);
    try {
      const { draft, sources } = await api.draft(ticket._id);
      onDraft(draft);
      setDraftInfo({ sources });
    } catch (err) {
      setDraftInfo({ error: err.message });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Handoff summary">
        {summary.text && <p className="text-sm text-slate-700">{summary.text}</p>}
        {summary.state === 'error' && <ErrorNote error={summary.error} />}
        <button
          onClick={generateSummary}
          disabled={summary.state === 'loading'}
          className="mt-2 rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {summary.state === 'loading' ? 'Summarizing…' : summary.text ? 'Regenerate summary' : 'Generate summary'}
        </button>
      </Card>

      <Card title="Suggested KB articles">
        {kb.state === 'loading' && <Loading />}
        {kb.state === 'error' && <ErrorNote error={kb.error} />}
        {kb.state === 'done' &&
          (kb.data.length === 0 ? (
            <p className="text-xs text-slate-400">No KB matches.</p>
          ) : (
            <ul className="space-y-2">
              {kb.data.map((m) => (
                <li key={m.article._id}>
                  <details className="group">
                    <summary className="cursor-pointer text-sm text-slate-800 hover:text-indigo-700">
                      {m.article.title}
                      <span className="ml-2 text-xs text-slate-400">
                        {m.article.category} · {m.score.toFixed(3)}
                      </span>
                    </summary>
                    <p className="mt-1 text-xs whitespace-pre-line text-slate-600">{m.article.body}</p>
                  </details>
                </li>
              ))}
            </ul>
          ))}
      </Card>

      <Card title="Similar past tickets">
        {similar.state === 'loading' && <Loading />}
        {similar.state === 'error' && <ErrorNote error={similar.error} />}
        {similar.state === 'done' &&
          (similar.data.matches.length === 0 ? (
            <p className="text-xs text-slate-400">
              No close precedent
              {similar.data.bestScore != null &&
                ` (best score ${similar.data.bestScore.toFixed(3)} < threshold ${similar.data.threshold})`}
              .
            </p>
          ) : (
            <ul className="space-y-3">
              {similar.data.matches.map((m) => (
                <li key={m.ticketId} className="rounded-md bg-emerald-50 p-2">
                  <p className="text-sm font-medium text-emerald-900">{m.subject}</p>
                  <p className="mt-1 text-xs text-emerald-800">{m.resolutionSummary}</p>
                  <p className="mt-1 text-[11px] text-emerald-600">similarity {m.score.toFixed(3)}</p>
                </li>
              ))}
            </ul>
          ))}
      </Card>

      <Card title="AI draft reply">
        <button
          onClick={generateDraft}
          disabled={drafting}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {drafting ? 'Drafting…' : 'Draft reply with AI'}
        </button>
        {draftInfo?.error && <div className="mt-2"><ErrorNote error={draftInfo.error} /></div>}
        {draftInfo?.sources && (
          <p className="mt-2 text-xs text-slate-500">
            Draft placed in the reply box. Grounded in:{' '}
            {draftInfo.sources.map((s) => s.title).join('; ')}
          </p>
        )}
      </Card>
    </div>
  );
}
