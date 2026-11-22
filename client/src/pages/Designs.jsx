import { useState } from 'react';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, Stat, confirmDelete, useApi } from '../components.jsx';
import { DueText, FeeText, PaidBadge, DesignCell, PaidOn, STATUS, STATUS_ORDER, StatusBadge } from '../designs.jsx';
import { rm, today } from '../utils.js';

// Owner view: assign design jobs to staff, follow progress, pay fees.
function DesignModal({ design, users, events, feeNow, onClose, onEmail }) {
  const [f, setF] = useState(design
    ? { ...design, event_id: design.event_id || '', assignee_id: design.assignee_id || '', due_date: design.due_date || '' }
    : { title: '', brief: '', event_id: '', assignee_id: users.find((u) => u.active)?.id || '', due_date: '', fee: feeNow, status: 'todo', file_link: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const outside = !!f.paid_on && !design?.transaction_id;
  const body = { title: f.title, brief: f.brief, event_id: f.event_id, assignee_id: f.assignee_id, due_date: f.due_date, status: f.status, file_link: f.file_link, fee: f.fee };
  if (!design?.transaction_id) { body.paid_on = f.paid_on || ''; body.paid_note = f.paid_on ? f.paid_note || '' : ''; }
  const save = async () => {
    const r = await (design ? api(`/designs/${design.id}`, { method: 'PUT', body }) : api('/designs', { method: 'POST', body }));
    onEmail?.(r.email ? { ...r.email, title: r.title } : null);
  };
  return (
    <FormModal title={design ? 'Edit design job' : 'New design job'} onClose={onClose} onSave={save} wide>
      <Field label="What to design"><input value={f.title} onChange={(e) => set('title', e.target.value)} required autoFocus placeholder="e.g. Poster for People Market 7–8 Nov" /></Field>
      <Field label="Brief" hint="Size, text, scents to feature, deadline notes…"><textarea rows={3} value={f.brief || ''} onChange={(e) => set('brief', e.target.value)} /></Field>
      <div className="row3">
        <Field label="Designer">
          <select value={f.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
            <option value="">Not assigned</option>
            {users.filter((u) => u.active || u.id === f.assignee_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="For event (optional)">
          <select value={f.event_id} onChange={(e) => set('event_id', e.target.value)}>
            <option value="">No event</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.start_date}</option>)}
          </select>
        </Field>
        <Field label="Due date"><input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
      </div>
      <div className="row3">
        <Field label="Fee (RM)" hint={design ? 'Fixed when the job was created.' : `Default RM ${Number(feeNow).toFixed(2)} (Settings).`}>
          <input type="number" min="0" step="0.01" value={f.fee} onChange={(e) => set('fee', e.target.value)} disabled={!!design?.paid} />
        </Field>
        {design && (
          <Field label="Status">
            <select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</select>
          </Field>
        )}
        {design && <Field label="File link"><input value={f.file_link || ''} onChange={(e) => set('file_link', e.target.value)} placeholder="https://…" /></Field>}
      </div>
      {!design?.transaction_id && (
        <>
          <label className="check">
            <input type="checkbox" checked={outside} onChange={(e) => setF((x) => ({ ...x, paid_on: e.target.checked ? today() : '', paid_note: e.target.checked ? x.paid_note : '' }))} />
            <span>Already paid outside the portal (the money is already in Cash flow, e.g. inside a worker payment). <b>No new cash entry.</b></span>
          </label>
          {outside && (
            <div className="row">
              <Field label="Paid on"><input type="date" value={f.paid_on} onChange={(e) => set('paid_on', e.target.value)} required /></Field>
              <Field label="How it was paid"><input value={f.paid_note || ''} onChange={(e) => set('paid_note', e.target.value)} placeholder="e.g. Included in RM320 (0001)" /></Field>
            </div>
          )}
        </>
      )}
      {design?.staff_note && <p className="small"><b>Note from {design.assignee_name || 'designer'}:</b> {design.staff_note}</p>}
    </FormModal>
  );
}

function PayModal({ design, onClose }) {
  const [date, setDate] = useState(today());
  return (
    <FormModal title={`Pay · ${design.title}`} saveLabel={`Pay ${rm(design.fee)}`} onClose={onClose}
      onSave={() => api(`/designs/${design.id}/pay`, { method: 'POST', body: { date } })}>
      <p className="muted small" style={{ marginBottom: 12 }}>Adds {rm(design.fee)} to Cash flow as money out (category "Design"), and it counts as a cost in the Monthly report.</p>
      <Field label="Paid on"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
    </FormModal>
  );
}

export default function Designs() {
  const designs = useApi('/designs');
  const users = useApi('/users');
  const events = useApi('/events');
  const [filter, setFilter] = useState('open');
  const [modal, setModal] = useState(null);
  const [emailNote, setEmailNote] = useState(null);
  const close = (saved) => { setModal(null); if (saved) designs.reload(); };

  if (!designs.data || !users.data) return <Loading state={designs.data ? users : designs} />;
  const rows = designs.data.rows;
  const shown = rows.filter((d) => (filter === 'open' ? d.status !== 'done' : filter === 'unpaid' ? d.status === 'done' && !d.paid : filter === 'all' ? true : d.status === filter));
  const unpaid = rows.filter((d) => d.status === 'done' && !d.paid);
  const month = today().slice(0, 7);
  const paidMonth = rows.filter((d) => d.paid && d.paid_date.startsWith(month)).reduce((a, d) => a + d.fee, 0);
  const noStaff = !users.data.some((u) => u.active);

  return (
    <>
      <PageHead title="Designs" sub="Poster and artwork jobs for your designer. You assign; she updates progress and adds the file link.">
        <button className="primary" onClick={() => setModal({ t: 'edit' })}>+ New design job</button>
      </PageHead>
      {emailNote && (
        <div className={emailNote.sent ? 'notice ok' : 'notice'}>
          {emailNote.sent ? <>Email "NELMORA NEW JOB" sent to <b>{emailNote.to}</b> for "{emailNote.title}".</> : <>Job saved, but no email was sent: {emailNote.reason}</>}
          <button className="link" style={{ marginLeft: 8 }} onClick={() => setEmailNote(null)}>Close</button>
        </div>
      )}
      {noStaff && <div className="notice">No staff account yet. Add your designer in <b>Settings → Staff accounts</b> so she can sign in and see her jobs.</div>}

      <div className="stats">
        <Stat label="Open jobs" value={rows.filter((d) => d.status !== 'done').length} sub={`${rows.filter((d) => d.status === 'doing').length} in progress`} />
        <Stat label="Done, not paid" value={rm(unpaid.reduce((a, d) => a + d.fee, 0))} sub={`${unpaid.length} design${unpaid.length === 1 ? '' : 's'}`} tone={unpaid.length ? 'neg' : ''} />
        <Stat label="Paid this month" value={rm(paidMonth)} sub={`Fee per design now: ${rm(designs.data.fee_now)}`} />
      </div>

      <div className="card">
        <div className="filters">
          <div className="seg">
            {[['open', 'Open'], ['unpaid', 'To pay'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
        </div>
        {shown.length === 0 ? <Empty>{filter === 'open' ? 'No open design jobs. Click "+ New design job" to assign one.' : 'Nothing here.'}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Design</th><th>Designer</th><th>Due</th><th>Status</th><th className="num">Fee</th><th className="nowrap">Paid on</th><th /></tr></thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <DesignCell d={d} showStaffNote />
                    </td>
                    <td>{d.assignee_name || <span className="muted">Not assigned</span>}</td>
                    <td className="nowrap"><DueText date={d.due_date} done={d.status === 'done'} /></td>
                    <td className="nowrap"><StatusBadge status={d.status} /> <PaidBadge d={d} /></td>
                    <td className="num"><FeeText d={d} /></td>
                    <td className="nowrap"><PaidOn d={d} /></td>
                    <td className="right nowrap">
                      {d.status === 'done' && !d.paid && <button className="link" onClick={() => setModal({ t: 'pay', d })}>Pay</button>}
                      {d.paid && <button className="link" onClick={async () => (await confirmDelete(d.paid_outside ? 'Mark this design as not paid?' : 'Undo this payment? The "Design" entry is removed from Cash flow.', () => api(`/designs/${d.id}/unpay`, { method: 'POST' }))) && designs.reload()}>Undo pay</button>}
                      <button className="link" onClick={() => setModal({ t: 'edit', d })}>Edit</button>
                      {!d.paid && <button className="link danger" onClick={async () => (await confirmDelete(`Delete "${d.title}"?`, () => api(`/designs/${d.id}`, { method: 'DELETE' }))) && designs.reload()}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.t === 'edit' && <DesignModal design={modal.d} users={users.data} events={events.data || []} feeNow={designs.data.fee_now} onClose={close} onEmail={setEmailNote} />}
      {modal?.t === 'pay' && <PayModal design={modal.d} onClose={close} />}
    </>
  );
}
