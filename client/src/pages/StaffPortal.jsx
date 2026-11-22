// Pages for staff (designer) accounts. They only call the staff routes: /designs (her own jobs),
// /staff/stock (bottle counts + scent notes) and /staff/events (names, places, dates). No money data.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, Stat, useApi } from '../components.jsx';
import { DueText, FeeText, PaidBadge, DesignCell, PaidOn, STATUS, STATUS_ORDER, StatusBadge, daysUntil } from '../designs.jsx';
import { fmtDate, rm, today } from '../utils.js';

const shortName = (n) => n.replace(/ \((10|30)ml\)$/, '');
const eventDates = (e) => (e.start_date === e.end_date ? fmtDate(e.start_date) : `${fmtDate(e.start_date)} – ${fmtDate(e.end_date)}`);

// ---------------------------------------------------------------- update one job (status, file link, note)
function UpdateModal({ design, onClose }) {
  const [f, setF] = useState({ status: design.status, file_link: design.file_link || '', staff_note: design.staff_note || '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <FormModal title={design.title} saveLabel="Save" onClose={onClose} onSave={() => api(`/designs/${design.id}`, { method: 'PUT', body: f })}>
      {design.brief && <div className="brief"><b>Brief</b><p>{design.brief}</p></div>}
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        {design.event_name ? <>For <b>{design.event_name}</b> · </> : null}Due <DueText date={design.due_date} done={design.status === 'done'} /> · Fee {rm(design.fee)}
      </p>
      <Field label="Status">
        <div className="seg">
          {STATUS_ORDER.map((s) => <button type="button" key={s} className={f.status === s ? 'on' : ''} onClick={() => set('status', s)}>{STATUS[s]}</button>)}
        </div>
      </Field>
      <Field label="File link" hint="Canva, Google Drive… link to the finished design."><input value={f.file_link} onChange={(e) => set('file_link', e.target.value)} placeholder="https://…" /></Field>
      <Field label="Note to owner (optional)"><textarea rows={2} value={f.staff_note} onChange={(e) => set('staff_note', e.target.value)} /></Field>
    </FormModal>
  );
}

function JobList({ rows, onOpen, empty }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Design</th><th>Due</th><th>Status</th><th className="num">My fee</th><th className="nowrap">Paid on</th><th /></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>
                <DesignCell d={d} />
              </td>
              <td className="nowrap"><DueText date={d.due_date} done={d.status === 'done'} /></td>
              <td className="nowrap"><StatusBadge status={d.status} /> <PaidBadge d={d} /></td>
              <td className="num"><FeeText d={d} /></td>
              <td className="nowrap"><PaidOn d={d} /></td>
              <td className="right"><button className="link" onClick={() => onOpen(d)}>Update</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard
export function StaffDashboard({ me }) {
  const designs = useApi('/designs');
  const events = useApi('/staff/events');
  const stock = useApi('/staff/stock');
  const [open, setOpen] = useState(null);
  if (!designs.data) return <Loading state={designs} />;
  const rows = designs.data.rows;
  const month = today().slice(0, 7);
  const active = rows.filter((d) => d.status !== 'done');
  const doneMonth = rows.filter((d) => d.status === 'done' && (d.done_date || '').startsWith(month));
  const unpaid = rows.filter((d) => d.status === 'done' && !d.paid);
  // Earnings: everything she has been paid, plus finished designs not paid yet.
  const earnedPaid = rows.filter((d) => d.paid).reduce((a, d) => a + d.fee, 0);
  const earnedWaiting = unpaid.reduce((a, d) => a + d.fee, 0);
  const upcoming = (events.data || []).filter((e) => e.end_date >= today()).sort((a, b) => (a.start_date < b.start_date ? -1 : 1)).slice(0, 5);
  const low = (stock.data || []).filter((s) => s.low).sort((a, b) => a.on_hand - b.on_hand);
  const hour = new Date().getHours();

  return (
    <>
      <PageHead title={`${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${me.name}`} sub="Your design jobs, upcoming events and what's running low." />
      <div className="stats">
        <Stat label="Total earned" value={rm(earnedPaid + earnedWaiting)} sub={`${rm(earnedPaid)} paid · ${rm(earnedWaiting)} waiting`} />
        <Stat label="Waiting for payment" value={rm(earnedWaiting)} sub={`${unpaid.length} design${unpaid.length === 1 ? '' : 's'} done, not paid yet`} />
        <Stat label="Jobs to do" value={active.length} sub={`${active.filter((d) => d.due_date && daysUntil(d.due_date) <= 3).length} due within 3 days`} />
        <Stat label="Done this month" value={doneMonth.length} sub={`${rm(doneMonth.reduce((a, d) => a + d.fee, 0))} in fees`} />
      </div>

      <div className="card">
        <h2>My open jobs <Link to="/designs">All my designs</Link></h2>
        <JobList rows={active} onOpen={setOpen} empty="No open jobs. New poster requests will show up here." />
      </div>

      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <h2>Upcoming events <Link to="/events">All events</Link></h2>
          {!upcoming.length ? <Empty>No upcoming events yet.</Empty> : (
            <ul className="plain-list">
              {upcoming.map((e) => {
                const n = daysUntil(e.start_date);
                return (
                  <li key={e.id}>
                    <div><b>{e.name}</b><div className="muted small">{e.location || 'Location not set'}</div></div>
                    <div className="right small"><div>{eventDates(e)}</div><div className={n <= 7 ? 'warn-text' : 'muted'}>{n <= 0 ? 'Now' : `in ${n} day${n === 1 ? '' : 's'}`}</div></div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="card">
          <h2>Running low <Link to="/stock">All stock</Link></h2>
          {!low.length ? <Empty>All scents have enough bottles.</Empty> : (
            <ul className="plain-list">
              {low.slice(0, 8).map((s) => (
                <li key={s.id}><span>{shortName(s.name)} <span className="muted small">{s.line}</span></span><b className={s.on_hand === 0 ? 'neg' : ''}>{s.on_hand === 0 ? 'Sold out' : `${s.on_hand} left`}</b></li>
              ))}
            </ul>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>Tip: avoid featuring sold-out scents on new posters.</p>
        </div>
      </div>
      {open && <UpdateModal design={open} onClose={(saved) => { setOpen(null); if (saved) designs.reload(); }} />}
    </>
  );
}

// ---------------------------------------------------------------- all my designs
export function MyDesigns() {
  const designs = useApi('/designs');
  const [filter, setFilter] = useState('open');
  const [open, setOpen] = useState(null);
  if (!designs.data) return <Loading state={designs} />;
  const rows = designs.data.rows;
  const shown = rows.filter((d) => (filter === 'open' ? d.status !== 'done' : filter === 'done' ? d.status === 'done' : true));
  const paid = rows.filter((d) => d.paid).reduce((a, d) => a + d.fee, 0);
  const unpaid = rows.filter((d) => d.status === 'done' && !d.paid).reduce((a, d) => a + d.fee, 0);
  return (
    <>
      <PageHead title="My designs" sub={`Fee per design: ${rm(designs.data.fee_now)}. Mark a job Done and add the file link when it's finished.`} />
      <div className="stats">
        <Stat label="Total paid to you" value={rm(paid)} sub={(() => { const n = rows.filter((d) => d.paid_outside && !(d.fee > 0)).length; return n ? `+ ${n} design${n === 1 ? '' : 's'} paid inside another payment` : undefined; })()} />
        <Stat label="Waiting for payment" value={rm(unpaid)} />
        <Stat label="Designs done" value={rows.filter((d) => d.status === 'done').length} />
      </div>
      <div className="card">
        <div className="filters">
          <div className="seg">{[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
        </div>
        <JobList rows={shown} onOpen={setOpen} empty={filter === 'open' ? 'No open jobs.' : 'Nothing here yet.'} />
      </div>
      {open && <UpdateModal design={open} onClose={(saved) => { setOpen(null); if (saved) designs.reload(); }} />}
    </>
  );
}

// ---------------------------------------------------------------- stock (counts + scent notes only)
export function StaffStock() {
  const stock = useApi('/staff/stock');
  const [size, setSize] = useState('30ml');
  if (!stock.data) return <Loading state={stock} />;
  const list = stock.data;
  return (
    <>
      <PageHead title="Stock" sub="Bottles available per scent, with scent notes for your poster copy." />
      <div className="card">
        <div className="size-switch">
          <div className="seg">
            {['30ml', '10ml'].map((s) => <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>{s} <span className="seg-count">{list.filter((p) => p.line === s).reduce((a, p) => a + p.on_hand, 0)}</span></button>)}
          </div>
        </div>
        <div className="stock-cols">
          {['Men', 'Women'].map((g) => {
            const items = list.filter((p) => p.line === size && p.gender === g);
            return (
              <div key={g} className="stock-col">
                <div className="stock-col-head"><b>{g}</b><span className="muted small">{items.reduce((a, p) => a + p.on_hand, 0)} bottles</span></div>
                <table className="compact">
                  <thead><tr><th>Scent</th><th className="num">On hand</th></tr></thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.id}>
                        <td>{shortName(p.name)}{p.notes && <div className="row-note">{p.notes}</div>}</td>
                        <td className="num">{p.low && <span className="low-tag">{p.on_hand === 0 ? 'sold out' : 'low'}</span>}<b>{p.on_hand}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- events (names, places, dates only)
export function StaffEvents() {
  const events = useApi('/staff/events');
  if (!events.data) return <Loading state={events} />;
  const now = today();
  const upcoming = events.data.filter((e) => e.end_date >= now).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const past = events.data.filter((e) => e.end_date < now);
  const List = ({ rows }) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Event</th><th>Location</th><th>Dates</th></tr></thead>
        <tbody>{rows.map((e) => <tr key={e.id}><td><b>{e.name}</b></td><td>{e.location || <span className="muted">Not set</span>}</td><td className="nowrap">{eventDates(e)}</td></tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <>
      <PageHead title="Events" sub="Important dates for posters and promotions." />
      <div className="card"><h2>Upcoming</h2>{upcoming.length ? <List rows={upcoming} /> : <Empty>No upcoming events yet.</Empty>}</div>
      <div className="card"><h2>Past events</h2>{past.length ? <List rows={past} /> : <Empty>None yet.</Empty>}</div>
    </>
  );
}

// ---------------------------------------------------------------- my account
export function MyAccount({ me, onLogout }) {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [msg, setMsg] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (f.next !== f.again) return setMsg({ ok: false, text: 'The two new passwords are different.' });
    try {
      await api('/me/password', { method: 'POST', body: { current: f.current, next: f.next } });
      setF({ current: '', next: '', again: '' });
      setMsg({ ok: true, text: 'Password changed.' });
    } catch (e2) { setMsg({ ok: false, text: e2.message }); }
  };
  return (
    <>
      <PageHead title="My account" sub={`${me.name} · ${me.email}`} />
      <form className="card" style={{ maxWidth: 480 }} onSubmit={save}>
        <h2>Change password</h2>
        {msg && <div className={msg.ok ? 'notice ok' : 'error'}>{msg.text}</div>}
        <Field label="Current password"><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 8 characters."><input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
        <Field label="New password again"><input type="password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} required minLength={8} autoComplete="new-password" /></Field>
        <button className="primary">Change password</button>
        <button type="button" style={{ marginLeft: 8 }} onClick={onLogout}>Log out</button>
      </form>
    </>
  );
}
