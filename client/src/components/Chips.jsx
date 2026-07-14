const chip = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const SENTIMENT_STYLES = {
  Positive: 'bg-green-100 text-green-800',
  Neutral: 'bg-slate-100 text-slate-700',
  Negative: 'bg-amber-100 text-amber-800',
  Angry: 'bg-red-100 text-red-800',
};

const PRIORITY_STYLES = {
  High: 'bg-red-100 text-red-800',
  Medium: 'bg-amber-100 text-amber-800',
  Low: 'bg-slate-100 text-slate-700',
};

const STATUS_STYLES = {
  Open: 'bg-blue-100 text-blue-800',
  'In Progress': 'bg-amber-100 text-amber-800',
  Resolved: 'bg-green-100 text-green-800',
};

export function SentimentChip({ value }) {
  if (!value) return null;
  return <span className={`${chip} ${SENTIMENT_STYLES[value]}`}>{value}</span>;
}

export function PriorityChip({ value }) {
  if (!value) return <span className={`${chip} bg-slate-100 text-slate-400`}>untriaged</span>;
  return <span className={`${chip} ${PRIORITY_STYLES[value]}`}>{value} priority</span>;
}

export function CategoryChip({ value }) {
  if (!value) return null;
  return <span className={`${chip} border border-indigo-200 text-indigo-700`}>{value}</span>;
}

export function StatusBadge({ value }) {
  return <span className={`${chip} ${STATUS_STYLES[value] ?? ''}`}>{value}</span>;
}
