import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, Stat, useApi } from '../components.jsx';
import { fmtDate, rm, today, tone } from '../utils.js';

export function EventModal({ event, settings, onClose }) {
  const [f, setF] = useState(
    event || {
      name: '', location: '', start_date: today(), end_date: today(), worker_days: 1,
      daily_wage: settings?.default_daily_wage ?? 100, commission_rate: settings?.default_commission ?? 3, note: '',
      plan_qty_30: '', plan_price_30: '', plan_qty_10: '', plan_price_10: '', plan_cost_30: '', plan_cost_10: '',
    }
  );
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => (event ? api(`/events/${event.id}`, { method: 'PUT', body: f }) : api('/events', { method: 'POST', body: f }));
  return (
    <FormModal title={event ? 'Edit event' : 'New event'} onClose={onClose} onSave={save}>
      <Field label="Event name"><input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus placeholder="e.g. People's Picnic Vol. 5" /></Field>
      <Field label="Location"><input value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
      <div className="row">
        <Field label="Start date"><input type="date" value={f.start_date} onChange={(e) => { set('start_date', e.target.value); if (f.end_date < e.target.value) set('end_date', e.target.value); }} required /></Field>
        <Field label="End date"><input type="date" min={f.start_date} value={f.end_date} onChange={(e) => set('end_date', e.target.value)} required /></Field>
      </div>
      <div className="row3">
        <Field label="Worker-days" hint="Workers × days"><input type="number" min="0" step="0.5" value={f.worker_days} onChange={(e) => set('worker_days', e.target.value)} /></Field>
        <Field label="Daily wage (RM)"><input type="number" min="0" step="0.01" value={f.daily_wage} onChange={(e) => set('daily_wage', e.target.value)} /></Field>
        <Field label="Commission / bottle"><input type="number" min="0" step="0.01" value={f.commission_rate} onChange={(e) => set('commission_rate', e.target.value)} /></Field>
      </div>
      <div className="form-section">
        <h3>Plan <span className="muted small">optional · your target for this event</span></h3>
        <div className="plan-grid">
          <span />
          <span className="muted small">Bottles to sell</span>
          <span className="muted small">Selling price (RM)</span>
          <span className="muted small">Cost / bottle (RM)</span>
          <b>30ml</b>
          <input type="number" min="0" step="1" value={f.plan_qty_30 || ''} onChange={(e) => set('plan_qty_30', e.target.value)} placeholder="0" aria-label="30ml bottles to sell" />
          <input type="number" min="0" step="0.01" value={f.plan_price_30 || ''} onChange={(e) => set('plan_price_30', e.target.value)} placeholder="e.g. 60" aria-label="30ml selling price" />
          <input type="number" min="0" step="any" value={f.plan_cost_30 || ''} onChange={(e) => set('plan_cost_30', e.target.value)} placeholder="from stock" aria-label="30ml cost per bottle" />
          <b>10ml</b>
          <input type="number" min="0" step="1" value={f.plan_qty_10 || ''} onChange={(e) => set('plan_qty_10', e.target.value)} placeholder="0" aria-label="10ml bottles to sell" />
          <input type="number" min="0" step="0.01" value={f.plan_price_10 || ''} onChange={(e) => set('plan_price_10', e.target.value)} placeholder="e.g. 16" aria-label="10ml selling price" />
          <input type="number" min="0" step="any" value={f.plan_cost_10 || ''} onChange={(e) => set('plan_cost_10', e.target.value)} placeholder="from stock" aria-label="10ml cost per bottle" />
        </div>
        <p className="muted small">Leave cost / bottle blank to use your current stock cost (leftover + restock blended). The portal works out profit, margin and break-even.</p>
      </div>
      <Field label="Note"><input value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
    </FormModal>
  );
}

export default function Events() {
  const ev = useApi('/events');
  const settings = useApi('/settings');
  const [modal, setModal] = useState(false);
  const nav = useNavigate();

  if (!ev.data) return <Loading state={ev} />;
  const done = ev.data.filter((e) => e.end_date < today());
  const totalProfit = done.reduce((a, e) => a + e.profit, 0);
  const totalRev = done.reduce((a, e) => a + e.revenue, 0);

  return (
    <>
      <PageHead title="Events" sub="Costing and profit for every booth. Click an event to see the full breakdown.">
        <button className="primary" onClick={() => setModal(true)}>+ New event</button>
      </PageHead>

      <div className="stats">
        <Stat label="Events held" value={done.length} />
        <Stat label="Event sales" value={rm(totalRev)} />
        <Stat label="Event profit (total)" value={rm(totalProfit)} tone={tone(totalProfit)} />
        <Stat label="Avg profit / event" value={done.length ? rm(totalProfit / done.length) : '–'} tone={tone(totalProfit)} />
      </div>

      <div className="card">
        {ev.data.length === 0 ? <Empty>No events yet. Create one to start tracking booth costs and sales.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Event</th><th>Dates</th><th className="num">Bottles</th><th className="num">Sales</th><th className="num">Costs</th><th className="num">Net profit</th><th className="num">Margin</th><th className="num">Planned profit</th></tr></thead>
              <tbody>
                {ev.data.map((e) => (
                  <tr key={e.id} className="click" onClick={() => nav(`/events/${e.id}`)}>
                    <td><b>{e.name}</b>{e.end_date >= today() && <span className="badge" style={{ marginLeft: 6 }}>upcoming</span>}<div className="muted small">{e.location}</div></td>
                    <td className="nowrap">{fmtDate(e.start_date)}{e.end_date !== e.start_date && ` – ${fmtDate(e.end_date)}`}</td>
                    <td className="num">{e.bottles}</td>
                    <td className="num">{rm(e.revenue)}</td>
                    <td className="num">{rm(e.total_costs + e.cogs)}</td>
                    <td className={'num ' + tone(e.profit)}>{rm(e.profit)}</td>
                    <td className="num">{e.revenue ? e.margin_pct + '%' : '–'}</td>
                    <td className={'num ' + (e.plan ? tone(e.plan.profit) : '')}>{e.plan ? rm(e.plan.profit) : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>Costs here include the cost of the bottles sold (at your average stock cost), wages, commission and booth expenses.</p>
      </div>

      {modal && <EventModal settings={settings.data} onClose={(saved) => { setModal(false); if (saved) ev.reload(); }} />}
    </>
  );
}
