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

// Fee cell: designs paid inside another payment (no separate fee) show "Included".
export function FeeText({ d }) {
  const rmFmt = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <>
      {d.paid_outside && !(d.fee > 0) ? <span className="muted">Included</span> : rmFmt(d.fee)}
      {d.paid && d.paid_date && (
        <div className="row-note"><b>Paid {new Date(d.paid_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b></div>
      )}
      {d.paid && <div className="row-note">{d.paid_note || (d.transaction_id ? 'Recorded in Cash flow (Design)' : '')}</div>}
    </>
  );
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
