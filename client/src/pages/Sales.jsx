import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, Loading, PageHead, Stat, confirmDelete, useApi } from '../components.jsx';
import SalesEntry from '../SalesEntry.jsx';
import { downloadCSV, fmtDate, monthLabel, rm, tone } from '../utils.js';

const CHANNEL = { booth: 'Booth', agent: 'Agent', online: 'Online', other: 'Direct selling' };
const ChannelBadge = ({ c }) => <span className={'badge ch-' + c}>{CHANNEL[c] || c}</span>;

export default function Sales() {
  const sales = useApi('/sales');
  const perBottle = useApi('/direct-profit');
  const events = useApi('/events');
  const monthly = useApi('/monthly');
  const [month, setMonth] = useState('');
  const [channel, setChannel] = useState('');
  const [modal, setModal] = useState(false);

  const all = sales.data || [];
  const months = useMemo(() => [...new Set(all.map((s) => s.date.slice(0, 7)))].sort().reverse(), [all]);
  const rows = all.filter((s) => (!month || s.date.startsWith(month)) && (!channel || s.channel === channel));

  const bottles = rows.reduce((a, s) => a + s.qty, 0);
  const revenue = rows.reduce((a, s) => a + s.revenue, 0);
  const cogs = rows.reduce((a, s) => a + s.cogs, 0);
  const commission = rows.reduce((a, s) => a + s.commission, 0);

  // Net profit = sales − perfume cost − commission − event costs (booth, workers, platform…) − other business expenses.
  const evIds = new Set(rows.filter((s) => s.event_id).map((s) => s.event_id));
  const eventCosts = (events.data || [])
    .filter((e) => evIds.has(e.id) || (!channel || channel === 'booth') && (!month || e.end_date.startsWith(month)) && e.end_date < new Date().toLocaleDateString('en-CA'))
    .reduce((a, e) => a + e.wages + e.other_costs, 0);
  const otherExp = channel ? 0 : (monthly.data || []).filter((m) => !month || m.month === month).reduce((a, m) => a + m.other_expenses - m.other_income, 0);
  const net = revenue - cogs - commission - eventCosts - otherExp;

  const byProduct = Object.values(
    rows.reduce((m, s) => {
      const r = (m[s.product_name] ||= { name: s.product_name, qty: 0, revenue: 0 });
      r.qty += s.qty; r.revenue += s.revenue;
      return m;
    }, {})
  ).sort((a, b) => b.qty - a.qty);

  const byChannel = Object.entries(
    rows.reduce((m, s) => { m[s.channel] = (m[s.channel] || 0) + s.revenue; return m; }, {})
  );

  if (!sales.data) return <Loading state={sales} />;

  return (
    <>
      <PageHead title="Sales" sub="Everything sold, from booths, agents and online.">
        <button onClick={() => downloadCSV('nelmora-sales.csv', rows.map((s) => ({ date: s.date, product: s.product_name, qty: s.qty, unit_price: s.unit_price, revenue: s.revenue, cost: s.cogs, commission: s.commission, channel: s.channel, event: s.event_name || '', agent: s.agent_name || '' })))}>Export CSV</button>
        <button className="primary" onClick={() => setModal(true)}>Record sales</button>
      </PageHead>

      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">All months</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          {Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="stats">
        <Stat label="Sales" value={rm(revenue)} sub={`${bottles} bottles`} />
        <Stat label="Perfume cost" value={rm(cogs)} tone="neg" sub="Cost of bottles sold" />
        <Stat label="Event & other costs" value={rm(eventCosts + commission + otherExp)} tone="neg" sub="Booth, workers, platform, commission" />
        <Stat label="Net profit" value={rm(net)} tone={tone(net)} sub={revenue ? `${Math.round((net / revenue) * 100)}% of sales` : ''} />
      </div>

      {perBottle.data?.some((l) => l.cost > 0) && (
        <div className="card">
          <h2>Profit per bottle, direct selling <span className="muted small" style={{ fontWeight: 400 }}>No booth, worker or platform costs</span></h2>
          <div className="kpis per-bottle">
            {perBottle.data.filter((l) => l.cost > 0).map((l) => (
              <div key={l.line}>
                <span>{l.line} · sell {rm(l.price)} − cost {rm(l.cost)}</span>
                <b>{rm(l.profit)}</b>
                <small>{l.margin_pct}% margin · cost from {l.from} sheet</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>By product</h2>
          {byProduct.length === 0 ? <Empty>No sales in this view.</Empty> : (
            <ul className="list">{byProduct.map((p) => <li key={p.name}><span>{p.name}</span><span><b>{p.qty}</b> <span className="muted small">· {rm(p.revenue)}</span></span></li>)}</ul>
          )}
        </div>
        <div className="card">
          <h2>By channel</h2>
          {byChannel.length === 0 ? <Empty>No sales in this view.</Empty> : (
            <ul className="list">{byChannel.map(([k, v]) => <li key={k}><ChannelBadge c={k} /><b>{rm(v)}</b></li>)}</ul>
          )}
        </div>
      </div>

      <div className="card">
        <h2>All entries</h2>
        {rows.length === 0 ? <Empty>No sales yet. Click "Record sales" after your next booth day.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th><th className="num">Perfume cost</th><th className="num">Profit</th><th>Channel</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap">{fmtDate(s.date)}</td>
                    <td>{s.product_name}</td>
                    <td className="num">{s.qty}</td>
                    <td className="num">{rm(s.unit_price)}</td>
                    <td className="num">{rm(s.revenue)}</td>
                    <td className="num" title={`${s.qty} × ${rm(s.unit_cost)} (${s.cost_from})`}>{s.cogs ? rm(s.cogs) : <span className="badge warn">no cost</span>}<div className="row-note">{rm(s.unit_cost)} × {s.qty}</div></td>
                    <td className={'num ' + (s.profit >= 0 ? 'pos' : 'neg')}>{rm(s.profit)}</td>
                    <td><ChannelBadge c={s.channel} /> <span className="muted small">{s.event_name || s.agent_name || ''}</span></td>
                    <td className="right"><button className="link danger" onClick={async () => (await confirmDelete('Delete this sale entry? Stock and profit will change.', () => api(`/sales/${s.id}`, { method: 'DELETE' }))) && sales.reload()}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && <SalesEntry onClose={(saved) => { setModal(false); if (saved) sales.reload(); }} />}
    </>
  );
}
