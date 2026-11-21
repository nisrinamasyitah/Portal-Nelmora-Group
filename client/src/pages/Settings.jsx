import { useEffect, useState } from 'react';
import { api, downloadBackup } from '../api.js';
import { Field, Loading, PageHead, useApi } from '../components.jsx';
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

export default function Settings({ onLogout }) {
  const st = useApi('/settings');
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { if (st.data) setF(st.data); }, [st.data]);
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

      <div className="card" style={{ maxWidth: 640 }}>
        <h2>Backup</h2>
        <p className="muted" style={{ marginBottom: 12 }}>All your data lives in one file (<code>data/nelmora.db</code>). Download a copy regularly and keep it somewhere safe, like Google Drive.</p>
        <button onClick={() => downloadBackup().catch((e) => setErr(e.message))}>Download backup</button>
        {onLogout && <button style={{ marginLeft: 8 }} onClick={onLogout}>Log out</button>}
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
