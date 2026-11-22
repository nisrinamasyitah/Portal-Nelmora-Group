// Shared bits for design jobs (owner's Designs page and the designer's own pages).
export const STATUS = { todo: 'To do', doing: 'In progress', done: 'Done' };
export const STATUS_ORDER = ['todo', 'doing', 'done'];

export function StatusBadge({ status }) {
  return <span className={'badge status-' + status}>{STATUS[status] || status}</span>;
}

export function PaidBadge({ d }) {
  if (d.paid) return <span className="badge paid">Paid</span>;
  if (d.status === 'done') return <span className="badge unpaid">Not paid yet</span>;
  return null;
}

// Days until a date (negative = overdue).
export const daysUntil = (date) => (date ? Math.round((new Date(date + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000) : null);

export function DueText({ date, done }) {
  if (!date) return <span className="muted">No due date</span>;
  const n = daysUntil(date);
  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (done) return <span className="muted">{label}</span>;
  if (n < 0) return <span className="neg">{label} · {-n} day{n === -1 ? '' : 's'} late</span>;
  if (n === 0) return <span className="neg">Today</span>;
  if (n <= 3) return <span className="warn-text">{label} · in {n} day{n === 1 ? '' : 's'}</span>;
  return <span>{label}</span>;
}
