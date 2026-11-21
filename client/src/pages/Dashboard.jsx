import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty, Loading, PageHead, Stat, useApi } from '../components.jsx';
import { COLORS, fmtDate, monthLabel, monthShort, rm, tone } from '../utils.js';

export default function Dashboard() {
  const st = useApi('/dashboard');
  const d = st.data;
  if (!d) return <Loading state={st} />;

  const fresh = d.stock_units === 0 && d.totals.bottles === 0;
  const m = d.this_month;

  return (
    <>
      <PageHead title="Dashboard" sub={`${monthLabel(d.today.slice(0, 7))} at a glance`} />

      {fresh && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Getting started</h2>
          <ol className="steps">
            <li><Link to="/settings">Settings</Link>: enter your opening cash, default wage and commission.</li>
            <li><Link to="/stock">Stock</Link>: rename the scents, then add your first production batch (use "opening stock" for bottles you already own).</li>
            <li><Link to="/events">Events</Link>: create an event and add its costs (booth fee, transport…).</li>
            <li>Record sales after each booth day. Profit, cash flow and stock update automatically.</li>
          </ol>
        </div>
      )}

      <div className="stats">
        <Stat label="Cash balance" value={rm(d.cash_balance)} tone={tone(d.cash_balance)} sub={d.last_update ? `Last update ${fmtDate(d.last_update.date)} · ${d.last_update.net >= 0 ? '+' : '−'}${rm(Math.abs(d.last_update.net))} ${d.last_update.categories.join(', ')}` : ''} />
        <Stat label="Sales this month" value={rm(m.revenue)} sub={`${m.bottles} bottles`} />
        <Stat label="Net profit this month" value={rm(m.net_profit)} tone={tone(m.net_profit)} sub={`All time: ${rm(d.totals.net_profit)}`} />
        <Stat label="Stock value" value={rm(d.stock_value)} sub={`${d.stock_units} bottles · ${d.stock_by_size.map((s) => `${s.units} × ${s.line}`).join(' · ')}`} />
      </div>

      <div className="card">
        <h2>Sales and net profit by month</h2>
        {d.monthly.length === 0 ? (
          <Empty>No sales yet. Your monthly chart will appear here.</Empty>
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={d.monthly.map((x) => ({ ...x, label: monthShort(x.month) }))} margin={{ left: -10, right: 8 }}>
                <CartesianGrid vertical={false} stroke={COLORS.line} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(v) => rm(v)} cursor={{ fill: 'rgba(107, 26, 46, 0.06)' }} />
                <Legend />
                <Bar dataKey="revenue" name="Sales" fill={COLORS.ink} radius={[4, 4, 0, 0]} />
                <Bar dataKey="net_profit" name="Net profit" fill={COLORS.silver} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Upcoming events <Link to="/events" className="small muted">All events</Link></h2>
          {d.upcoming_events.length === 0 ? <Empty>Nothing scheduled.</Empty> : (
            <ul className="list">
              {d.upcoming_events.map((e) => (
                <li key={e.id}>
                  <span><Link to={`/events/${e.id}`}>{e.name}</Link><div className="muted small">{fmtDate(e.start_date)} – {fmtDate(e.end_date)}</div></span>
                  <span className="muted small nowrap">Costs {rm(e.total_costs)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Needs restocking</h2>
          {d.low_stock.length === 0 ? <Empty>All scents have 5 or more bottles.</Empty> : (
            <ul className="list">
              {d.low_stock.map((s) => (
                <li key={s.id}><span>{s.name}</span><span><span className="badge warn">{s.on_hand} left</span></span></li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Bottles sold (last 90 days)</h2>
          <ul className="list">
            {d.sold_by_size.map((s) => <li key={s.line}><span><span className={'badge size-' + s.line}>{s.line}</span></span><b>{s.qty}</b></li>)}
            {d.top_sellers.map((s) => <li key={s.name}><span>{s.name}</span><b>{s.qty}</b></li>)}
          </ul>
          {d.top_sellers.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>Top scents will show here once sales are recorded per scent.</p>}
        </div>

        <div className="card">
          <h2>Recent events</h2>
          {d.recent_events.length === 0 ? <Empty>No finished events yet.</Empty> : (
            <ul className="list">
              {d.recent_events.map((e) => (
                <li key={e.id}>
                  <span>
                    <Link to={`/events/${e.id}`}>{e.name}</Link>
                    <div className="muted small">{fmtDate(e.end_date)} · {e.bottles} bottles · {rm(e.revenue)} sales</div>
                  </span>
                  <b className={'nowrap ' + tone(e.profit)}>{rm(e.profit)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
