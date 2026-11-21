import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, Stat, confirmDelete, useApi } from '../components.jsx';
import SalesEntry from '../SalesEntry.jsx';
import { fmtDate, rm } from '../utils.js';

function AgentModal({ agent, onClose }) {
  const [f, setF] = useState(agent || { name: '', phone: '', note: '', active: 1 });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => (agent ? api(`/agents/${agent.id}`, { method: 'PUT', body: f }) : api('/agents', { method: 'POST', body: f }));
  return (
    <FormModal title={agent ? 'Edit agent' : 'Add agent'} onClose={onClose} onSave={save}>
      <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></Field>
      <Field label="Phone"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Note"><input value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
    </FormModal>
  );
}

export default function Agents() {
  const agents = useApi('/agents');
  const sales = useApi('/sales?channel=agent');
  const settings = useApi('/settings');
  const [modal, setModal] = useState(null);

  const reload = () => { agents.reload(); sales.reload(); };
  const close = (saved) => { setModal(null); if (saved) reload(); };

  if (!agents.data) return <Loading state={agents} />;
  const totalComm = agents.data.reduce((a, x) => a + x.commission, 0);
  const totalRev = agents.data.reduce((a, x) => a + x.revenue, 0);
  const tiers = [...(settings.data?.agent_tiers || [])].sort((a, b) => a.min - b.min);

  return (
    <>
      <PageHead title="Agents" sub="Agents sell at full retail price. You pay a commission per bottle.">
        <button onClick={() => setModal({ t: 'agent' })}>+ Add agent</button>
        <button className="primary" onClick={() => setModal({ t: 'sale' })} disabled={!agents.data.length}>Record agent sale</button>
      </PageHead>

      <div className="stats">
        <Stat label="Agents" value={agents.data.filter((a) => a.active).length} />
        <Stat label="Agent sales" value={rm(totalRev)} />
        <Stat label="Commission earned" value={rm(totalComm)} />
      </div>

      <div className="grid" style={{ marginTop: 16, gridTemplateColumns: 'minmax(0,2fr) minmax(240px,1fr)' }}>
        <div className="card">
          <h2>Your agents</h2>
          {agents.data.length === 0 ? <Empty>No agents yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Agent</th><th className="num">Bottles</th><th className="num">Sales</th><th className="num">Commission</th><th>Last sale</th><th /></tr></thead>
                <tbody>
                  {agents.data.map((a) => (
                    <tr key={a.id} style={a.active ? undefined : { opacity: 0.5 }}>
                      <td>{a.name}{!a.active && <span className="badge" style={{ marginLeft: 6 }}>inactive</span>}<div className="muted small">{a.phone}</div></td>
                      <td className="num">{a.bottles}</td>
                      <td className="num">{rm(a.revenue)}</td>
                      <td className="num">{rm(a.commission)}</td>
                      <td className="nowrap">{a.last_sale ? fmtDate(a.last_sale) : '–'}</td>
                      <td className="right nowrap">
                        <button className="link" onClick={() => setModal({ t: 'agent', agent: a })}>Edit</button>
                        <button className="link danger" onClick={async () => (await confirmDelete(`Delete ${a.name}?`, () => api(`/agents/${a.id}`, { method: 'DELETE' }))) && reload()}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Commission tiers <Link to="/settings" className="small muted">Change</Link></h2>
          {tiers.length === 0 ? <Empty>No tiers set.</Empty> : (
            <ul className="list">
              {tiers.map((t, i) => (
                <li key={t.min}><span>{t.min}{tiers[i + 1] ? `–${tiers[i + 1].min - 1}` : '+'} bottles</span><b>{rm(t.rate)} / bottle</b></li>
              ))}
            </ul>
          )}
          <p className="muted small" style={{ marginTop: 10 }}>The tier is set by an agent's total bottles on the same date. Orders below {tiers[0]?.min ?? '–'} bottles earn no commission.</p>
        </div>
      </div>

      <div className="card">
        <h2>Recent agent sales</h2>
        {!sales.data?.length ? <Empty>No agent sales yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Agent</th><th>Product</th><th className="num">Qty</th><th className="num">Sales</th><th className="num">Commission</th></tr></thead>
              <tbody>
                {sales.data.slice(0, 30).map((s) => (
                  <tr key={s.id}><td className="nowrap">{fmtDate(s.date)}</td><td>{s.agent_name}</td><td>{s.product_name}</td><td className="num">{s.qty}</td><td className="num">{rm(s.revenue)}</td><td className="num">{rm(s.commission)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.t === 'agent' && <AgentModal agent={modal.agent} onClose={close} />}
      {modal?.t === 'sale' && <SalesEntry channel="agent" onClose={close} />}
    </>
  );
}
