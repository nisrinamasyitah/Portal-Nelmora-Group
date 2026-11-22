import { useState } from 'react';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, Modal, PageHead, Stat, useApi } from '../components.jsx';
import { rm } from '../utils.js';

// Owner / admin page: everyone who can sign in, their details and access, and controls (freeze, password, edit).

const when = (iso) => {
  if (!iso) return 'Never';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return iso.length === 10 ? date : `${date}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
const ROLE = { designer: 'Designer' };

function StatusBadge({ u }) {
  return u.active ? <span className="badge status-done">Active</span> : <span className="badge unpaid">Frozen</span>;
}

// Add a staff member, or edit details / reset password.
function StaffModal({ user, onClose, passwordOnly }) {
  const [f, setF] = useState(user ? { name: user.name, email: user.email, notify_email: user.notify_email || '', password: '' } : { name: '', email: '', notify_email: '', password: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (passwordOnly) return api(`/users/${user.id}`, { method: 'PUT', body: { password: f.password } });
    const body = { name: f.name, email: f.email, notify_email: f.notify_email };
    if (f.password) body.password = f.password;
    return user ? api(`/users/${user.id}`, { method: 'PUT', body }) : api('/users', { method: 'POST', body: { ...body, password: f.password } });
  };
  if (passwordOnly) {
    return (
      <FormModal title={`Reset password · ${user.name}`} saveLabel="Set new password" onClose={onClose} onSave={save}>
        <Field label="New password" hint="At least 8 characters. Give it to her in person; she can change it under My account.">
          <input type="text" value={f.password} onChange={(e) => set('password', e.target.value)} required minLength={8} autoFocus autoComplete="new-password" />
        </Field>
      </FormModal>
    );
  }
  return (
    <FormModal title={user ? `Edit ${user.name}` : 'Add staff account'} onClose={onClose} onSave={save}>
      <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus placeholder="e.g. Amira" /></Field>
      <Field label="Sign-in email"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required autoComplete="off" /></Field>
      <Field label="Notification email" hint="Job emails go here (e.g. her Gmail). Leave blank to use the sign-in email.">
        <input type="email" value={f.notify_email} onChange={(e) => set('notify_email', e.target.value)} placeholder="e.g. name@gmail.com" autoComplete="off" />
      </Field>
      {!user && (
        <Field label="Password" hint="At least 8 characters. Give it to her in person; she can change it after signing in.">
          <input type="text" value={f.password} onChange={(e) => set('password', e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
      )}
      <p className="muted small" style={{ marginTop: 6 }}>Role: <b>Designer</b>. Sees only her design jobs and fees, stock counts, event dates and scent notes. Never sees cash flow, sales, costs or profit.</p>
    </FormModal>
  );
}

// Freeze / unfreeze with a clear explanation of what happens.
function FreezeModal({ user, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const freeze = !!user.active;
  const go = async () => {
    setBusy(true); setErr('');
    try { await api(`/users/${user.id}`, { method: 'PUT', body: { active: !freeze } }); onClose(true); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={`${freeze ? 'Freeze' : 'Unfreeze'} ${user.name}?`} onClose={() => onClose(false)}>
      {err && <div className="error">{err}</div>}
      {freeze ? (
        <ul className="steps" style={{ marginTop: 0 }}>
          <li>She is <b>signed out straight away</b> on every device and cannot sign in.</li>
          <li>She gets <b>no job emails</b> while frozen.</li>
          <li>Her design jobs, fees and history are <b>kept</b>. You can unfreeze her any time.</li>
        </ul>
      ) : (
        <p>{user.name} will be able to sign in again with her current password, and job emails start again.</p>
      )}
      <div className="modal-foot">
        <button type="button" onClick={() => onClose(false)}>Cancel</button>
        <button className={freeze ? 'primary danger-bg' : 'primary'} onClick={go} disabled={busy}>{busy ? 'Saving…' : freeze ? 'Freeze account' : 'Unfreeze account'}</button>
      </div>
    </Modal>
  );
}

function StaffCard({ u, onAction }) {
  const rows = [
    ['Role', ROLE[u.role] || u.role],
    ['Sign-in email', u.email],
    ['Job emails to', u.notify_email || u.email],
    ['Last sign-in', when(u.last_login)],
    ['Account created', when(u.created)],
    !u.active && ['Frozen since', when(u.frozen_at)],
  ].filter(Boolean);
  return (
    <div className={'card staff-card' + (u.active ? '' : ' frozen')}>
      <div className="staff-head">
        <div>
          <h2 style={{ marginBottom: 2 }}>{u.name} <StatusBadge u={u} /></h2>
          <span className="muted small">{ROLE[u.role] || u.role} · design jobs, stock counts and event dates only</span>
        </div>
        <div className="actions">
          <button onClick={() => onAction('edit', u)}>Edit details</button>
          <button onClick={() => onAction('password', u)}>Reset password</button>
          <button className={u.active ? 'danger' : 'primary'} onClick={() => onAction('freeze', u)}>{u.active ? 'Freeze' : 'Unfreeze'}</button>
        </div>
      </div>
      <div className="staff-grid">
        <table className="compact details">
          <tbody>{rows.map(([k, v]) => <tr key={k}><td className="muted">{k}</td><td><b>{v}</b></td></tr>)}</tbody>
        </table>
        <div className="staff-stats">
          <div><span className="muted small">Designs</span><b>{u.designs}</b><span className="muted small">{u.open_jobs} open · {u.done_jobs} done</span></div>
          <div><span className="muted small">Earned</span><b>{rm(u.paid + u.waiting)}</b><span className="muted small">{rm(u.paid)} paid</span></div>
          <div><span className="muted small">Waiting for payment</span><b className={u.waiting ? 'neg' : ''}>{rm(u.waiting)}</b><span className="muted small">{u.last_job ? `last job ${when(u.last_job)}` : 'no jobs yet'}</span></div>
        </div>
      </div>
    </div>
  );
}

export default function Team({ me }) {
  const users = useApi('/users');
  const [modal, setModal] = useState(null);
  const close = (saved) => { setModal(null); if (saved) users.reload(); };
  if (!users.data) return <Loading state={users} />;
  const staff = users.data;
  const active = staff.filter((u) => u.active).length;

  return (
    <>
      <PageHead title="Team & access" sub="Who can sign in to the portal, what they can see, and their account controls.">
        <button className="primary" onClick={() => setModal({ t: 'edit' })}>+ Add staff</button>
      </PageHead>

      <div className="stats">
        <Stat label="People with access" value={staff.length + 1} sub={`You + ${staff.length} staff`} />
        <Stat label="Active staff" value={active} sub={staff.length - active ? `${staff.length - active} frozen` : 'None frozen'} />
        <Stat label="Waiting for payment" value={rm(staff.reduce((a, u) => a + u.waiting, 0))} sub="Finished designs not paid yet" />
      </div>

      <div className="card owner-card">
        <div className="staff-head">
          <div>
            <h2 style={{ marginBottom: 2 }}>{me?.name || 'Owner'} <span className="badge paid">Owner · Admin</span></h2>
            <span className="muted small">{me?.email} · full access to everything</span>
          </div>
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          You see all pages (cash flow, sales, stock, events, designs, settings) and control every staff account here.
          Your own sign-in is set in Netlify (PORTAL_EMAIL / PORTAL_PASSWORD) and can't be frozen.
        </p>
      </div>

      {staff.length === 0 ? <div className="card"><Empty>No staff yet. Click "+ Add staff" to give your designer her own sign-in.</Empty></div>
        : staff.map((u) => <StaffCard key={u.id} u={u} onAction={(t, user) => setModal({ t, user })} />)}

      {modal?.t === 'edit' && <StaffModal user={modal.user} onClose={close} />}
      {modal?.t === 'password' && <StaffModal user={modal.user} onClose={close} passwordOnly />}
      {modal?.t === 'freeze' && <FreezeModal user={modal.user} onClose={close} />}
    </>
  );
}
