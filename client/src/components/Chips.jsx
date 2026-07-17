const chip = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const label = (value) =>
  value
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

const SENTIMENT_STYLES = {
  positive: 'bg-green-100 text-green-800',
  neutral: 'bg-cream-300 text-ink-600',
  negative: 'bg-amber-100 text-amber-800',
  angry: 'bg-red-100 text-red-800',
};

const PRIORITY_STYLES = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-cream-300 text-ink-600',
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
  if (!value) return <span className={`${chip} bg-cream-300 text-ink-400`}>untriaged</span>;
  return <span className={`${chip} ${PRIORITY_STYLES[value] ?? ''}`}>{label(value)} priority</span>;
}

export function CategoryChip({ value }) {
  if (!value) return null;
  return <span className={`${chip} border border-clay-400 text-clay-700`}>{label(value)}</span>;
}

export function StatusBadge({ value }) {
  return <span className={`${chip} ${STATUS_STYLES[value] ?? ''}`}>{label(value)}</span>;
}

export function RoleBadge({ value }) {
  const styles = {
    user: 'bg-cream-300 text-ink-600',
    salesperson: 'bg-clay-100 text-clay-700',
    admin: 'bg-ink-800 text-cream-50',
  };
  return <span className={`${chip} ${styles[value] ?? ''}`}>{label(value)}</span>;
}

// Only renders for non-English tickets - an English ticket needs no badge.
export function LanguageChip({ value }) {
  if (!value || value === 'en') return null;
  return <span className={`${chip} border border-ink-300 uppercase text-ink-600`}>{value}</span>;
}

export function AutoClosedBadge({ show }) {
  if (!show) return null;
  return <span className={`${chip} bg-purple-100 text-purple-800`}>Auto-closed by AI</span>;
}
