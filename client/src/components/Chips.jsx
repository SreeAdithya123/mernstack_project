const chip = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const label = (value) =>
  value
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

const SENTIMENT_STYLES = {
  positive: 'bg-green-100 text-green-800',
  neutral: 'bg-slate-100 text-slate-700',
  negative: 'bg-amber-100 text-amber-800',
  angry: 'bg-red-100 text-red-800',
};

const PRIORITY_STYLES = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-slate-100 text-slate-700',
};

const STATUS_STYLES = {
  open: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-amber-100 text-amber-800',
  resolved: 'bg-green-100 text-green-800',
};

export function SentimentChip({ value }) {
  if (!value) return null;
  return <span className={`${chip} ${SENTIMENT_STYLES[value] ?? ''}`}>{label(value)}</span>;
}

export function PriorityChip({ value }) {
  if (!value) return <span className={`${chip} bg-slate-100 text-slate-400`}>untriaged</span>;
  return <span className={`${chip} ${PRIORITY_STYLES[value] ?? ''}`}>{label(value)} priority</span>;
}

export function CategoryChip({ value }) {
  if (!value) return null;
  return <span className={`${chip} border border-indigo-200 text-indigo-700`}>{label(value)}</span>;
}

export function StatusBadge({ value }) {
  return <span className={`${chip} ${STATUS_STYLES[value] ?? ''}`}>{label(value)}</span>;
}

export function RoleBadge({ value }) {
  const styles = {
    user: 'bg-slate-100 text-slate-700',
    salesperson: 'bg-indigo-100 text-indigo-800',
    admin: 'bg-purple-100 text-purple-800',
  };
  return <span className={`${chip} ${styles[value] ?? ''}`}>{label(value)}</span>;
}
