import { useEffect, useState } from 'react';
import { api, downloadBackup, restoreBackup } from '../api.js';
import { Field, FormModal, Loading, PageHead, useApi } from '../components.jsx';
import { FONTS, applyFont, getFont, loadFont } from '../fonts.js';

function FontPicker() {
  const [current, setCurrent] = useState(getFont);
  useEffect(() => { FONTS.forEach((f) => loadFont(f.name)); }, []);
  const pick = (name) => { applyFont(name); setCurrent(name); };
  return (
    <div className="card">
      <h2>Font <span className="muted small" style={{ fontWeight: 400 }}>Click to try it on the whole portal. Saved on this browser.</span></h2>
      <div className="font-grid">
        {FONTS.map((f) => (
          <button type="button" key={f.name} className={'font-opt' + (f.name === current ? ' on' : '')}
            style={{ fontFamily: `'${f.name}', sans-serif` }} onClick={() => pick(f.name)} aria-pressed={f.name === current}>
            <span className="font-name">{f.name}{f.name === current && <span className="badge in">In use</span>}</span>
            <span className="font-sample">RM 12,480.00</span>
            <span className="font-text">Sales this month · Stock value</span>
            <span className="font-note">{f.note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Staff logins. A designer sees only her design jobs and fees, stock counts, event dates and scent notes.
function StaffModal({ user, onClose }) {
  const [f, setF] = useState(user ? { name: user.name, email: user.email, password: '', active: !!user.active } : { name: '', email: '', password: '', active: true });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    const body = { name: f.name, email: f.email, active: f.active };
    if (f.password) body.password = f.password;
    return user ? api(`/users/${user.id}`, { method: 'PUT', body }) : api('/users', { method: 'POST', body: { ...body, password: f.password } });
  };
  return (
    <FormModal title={user ? `Edit ${user.name}` : 'Add staff account'} onClose={onClose} onSave={save}>
      <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus placeholder="e.g. Amira" /></Field>
      <Field label="Email (her sign-in)"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required autoComplete="off" /></Field>
      <Field label={user ? 'New password (leave blank to keep)' : 'Password'} hint="At least 8 characters. Give it to her in person; she can change it after signing in.">
        <input type="text" value={f.password} onChange={(e) => set('password', e.target.value)} required={!user} minLength={8} autoComplete="new-password" />
      </Field>
      {user && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Can sign in (untick to lock her out straight away)</label>}
      <p className="muted small" style={{ marginTop: 10 }}>Role: <b>Designer</b>. Sees her design jobs and fees, stock counts, event dates and scent notes. Never sees cash flow, sales, costs or profit.</p>
    </FormModal>
  );
}

function StaffAccounts() {
  const users = useApi('/users');
  const [modal, setModal] = useState(null);
  const close = (saved) => { setModal(null); if (saved) users.reload(); };
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h2>Staff accounts <button onClick={() => setModal({})}>+ Add staff</button></h2>
      {!users.data ? <Loading state={users} /> : users.data.length === 0 ? <p className="muted">No staff yet. Add your designer so she can sign in with her own email and password.</p> : (
        <table className="compact">
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                <td><b>{u.name}</b><div className="muted small">{u.email}</div></td>
                <td>Designer{!u.active && <span className="badge" style={{ marginLeft: 6 }}>locked</span>}</td>
                <td className="right"><button className="link" onClick={() => setModal({ user: u })}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal && <StaffModal user={modal.user} onClose={close} />}
    </div>
  );
}

export default function Settings({ onLogout }) {
  const st = useApi('/settings');
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [restoreMsg, setRestoreMsg] = useState(null);

  useEffect(() => { if (st.data) setF(st.data); }, [st.data]);

  const restore = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(`Replace ALL data in this portal with "${file.name}"?\n\nEverything currently here will be replaced by the backup.`)) return;
    setRestoreMsg({ ok: true, text: 'Restoring…' });
    try {
      const r = await restoreBackup(file);
      setRestoreMsg({ ok: true, text: `Restored: ${r.sales} sales and ${r.products} products. Reloading…` });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e2) { setRestoreMsg({ ok: false, text: e2.message }); }
  };
  if (!f) return <Loading state={st} />;

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setTier = (i, k, v) => set('agent_tiers', f.agent_tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  const save = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api('/settings', { method: 'PUT', body: f });
      setMsg('Saved.');
      st.reload();
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <>
      <PageHead title="Settings" sub="Defaults used across the portal." />
      <FontPicker />
      <form className="card" onSubmit={save} style={{ maxWidth: 640 }}>
        {err && <div className="error">{err}</div>}
        {msg && <div className="notice ok">{msg}</div>}
        <div className="row">
          <Field label="Business name"><input value={f.business_name} onChange={(e) => set('business_name', e.target.value)} /></Field>
          <Field label="Opening cash (RM)" hint="Money in your business account on the date below."><input type="number" step="0.01" value={f.opening_cash} onChange={(e) => set('opening_cash', e.target.value)} /></Field>
        </div>
        <Field label="Opening cash as of" hint="Entries on or before this date are already inside your opening cash, so they won't be counted twice. Leave blank if the opening cash is from before your first entry.">
          <input type="date" value={f.opening_cash_date || ''} onChange={(e) => set('opening_cash_date', e.target.value)} style={{ maxWidth: 220 }} />
        </Field>
        <div className="row">
          <Field label="Default daily wage (RM)" hint="Pre-filled for new events. Each event keeps its own rate."><input type="number" step="0.01" min="0" value={f.default_daily_wage} onChange={(e) => set('default_daily_wage', e.target.value)} /></Field>
          <Field label="Default booth commission (RM / bottle)"><input type="number" step="0.01" min="0" value={f.default_commission} onChange={(e) => set('default_commission', e.target.value)} /></Field>
        </div>

        <div className="row">
          <Field label="Design fee (RM per design)" hint="Pre-filled for new design jobs. Each job keeps its own fee."><input type="number" step="0.01" min="0" value={f.design_fee_base ?? 20} onChange={(e) => set('design_fee_base', e.target.value)} /></Field>
          <Field label="Plus (%)" hint={`= RM ${((Number(f.design_fee_base ?? 20) || 0) * (1 + (Number(f.design_fee_pct ?? 6) || 0) / 100)).toFixed(2)} per design`}><input type="number" step="0.01" min="0" value={f.design_fee_pct ?? 6} onChange={(e) => set('design_fee_pct', e.target.value)} /></Field>
        </div>

        <Field label="Agent commission tiers" hint="Per bottle, based on the agent's total bottles on one date. Below the lowest tier = no commission.">
          {f.agent_tiers.map((t, i) => (
            <div key={i} className="row" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'center', marginBottom: 6 }}>
              <input type="number" min="1" value={t.min} onChange={(e) => setTier(i, 'min', e.target.value)} placeholder="From bottles" aria-label="From bottles" />
              <input type="number" min="0" step="0.01" value={t.rate} onChange={(e) => setTier(i, 'rate', e.target.value)} placeholder="RM / bottle" aria-label="RM per bottle" />
              <button type="button" className="link danger" onClick={() => set('agent_tiers', f.agent_tiers.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <div><button type="button" onClick={() => set('agent_tiers', [...f.agent_tiers, { min: '', rate: '' }])}>+ Add tier</button></div>
        </Field>

        <button className="primary">Save settings</button>
      </form>

      <StaffAccounts />

      <div className="card" style={{ maxWidth: 640 }}>
        <h2>Backup</h2>
        <p className="muted" style={{ marginBottom: 12 }}>All your data lives in one file (<code>nelmora.db</code>). Download a copy regularly and keep it somewhere safe, like Google Drive.</p>
        {restoreMsg && <div className={restoreMsg.ok ? 'notice ok' : 'error'}>{restoreMsg.text}</div>}
        <button onClick={() => downloadBackup().catch((e) => setRestoreMsg({ ok: false, text: e.message }))}>Download backup</button>
        <label className="btn" style={{ marginLeft: 8, cursor: 'pointer' }}>
          Restore backup…
          <input type="file" accept=".db,application/octet-stream" style={{ display: 'none' }} onChange={restore} />
        </label>
        {onLogout && <button style={{ marginLeft: 8 }} onClick={onLogout}>Log out</button>}
        <p className="muted small" style={{ marginTop: 10 }}>Restore replaces <b>all</b> data in this portal with the backup file. Download a backup first if you might need the current data.</p>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <h2>How the numbers work</h2>
        <ul className="steps">
          <li><b>Stock cost</b> uses a moving average, so leftover bottles blend with new batches and nothing is charged twice.</li>
          <li><b>Event profit</b> = sales − cost of bottles sold − wages − commission − booth costs.</li>
          <li><b>Cash flow</b> is built from sales, stock purchases, event costs and manual entries. You never enter anything twice.</li>
        </ul>
      </div>
    </>
  );
}
