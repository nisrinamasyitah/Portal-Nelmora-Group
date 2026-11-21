import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, Stat, confirmDelete, useApi } from '../components.jsx';
import SalesEntry from '../SalesEntry.jsx';
import { EventModal } from './Events.jsx';
import { fmtDate, rm, today, tone } from '../utils.js';

const COST_CATS = ['Booth fee', 'Extra income', 'Worker / helper', 'Platform / ads fee', 'Transport', 'Parking', 'Deposit', 'Banner / printing', 'Table & display', 'Food & drinks', 'Testers / samples', 'Other'];

function CostModal({ eventId, cost, defaultDate, lastDate, onClose }) {
  const [f, setF] = useState(cost || { date: defaultDate, category: COST_CATS[0], description: '', amount: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => (cost ? api(`/costs/${cost.id}`, { method: 'PUT', body: f }) : api(`/events/${eventId}/costs`, { method: 'POST', body: f }));
  return (
    <FormModal title={cost ? 'Edit cost' : 'Add event cost'} onClose={onClose} onSave={save}>
      <div className="row">
        <Field label="Category"><select value={f.category} onChange={(e) => { const c = e.target.value; setF((x) => ({ ...x, category: c, ...(cost ? {} : { date: /worker|helper/i.test(c) ? lastDate : defaultDate }) })); }}>{[...new Set([...COST_CATS, f.category])].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Amount (RM)" hint={f.category === 'Extra income' ? 'Type it as a minus, e.g. -10' : undefined}><input type="number" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} required autoFocus /></Field>
      </div>
      <Field label="Date paid" hint="Used for your cash flow. Workers default to the last day of the event."><input type="date" value={f.date || ''} onChange={(e) => set('date', e.target.value)} /></Field>
      <Field label="Description"><input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Booth rental for 3 days" /></Field>
    </FormModal>
  );
}

function PlanSection({ e, onEdit }) {
  const p = e.plan;
  if (!p) {
    return (
      <div className="card plan-empty">
        <div>
          <h2 style={{ marginBottom: 4 }}>Event plan</h2>
          <p className="muted">Set how many bottles you aim to sell and at what price. You'll see projected profit, margin, break-even and price scenarios, like your costing sheet.</p>
        </div>
        <button className="primary" onClick={onEdit}>Set a plan</button>
      </div>
    );
  }
  const hasActual = e.bottles > 0;
  const short = p.lines.filter((l) => l.left_after < 0);
  const upcoming = e.end_date >= today();
  const rows = [
    ['Bottles', p.bottles, e.bottles, false],
    ['Sales', p.sales, e.revenue, true],
    ['Cost of bottles', p.variable, e.cogs, true],
    ['Wages & booth costs', p.fixed, e.wages + e.other_costs, true],
    ['Booth commission', p.commission, e.commission, true],
    ['Total cost', p.total_cost, e.cogs + e.total_costs, true],
  ];
  return (
    <>
      {upcoming && short.length > 0 && (
        <div className="notice" style={{ marginTop: 20 }}>
          Not enough stock: {short.map((l) => `${l.size} needs ${-l.left_after} more bottle(s)`).join(', ')}. Add a restock batch in Stock.
        </div>
      )}
      <div className="grid plan-grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h2>Plan {hasActual ? 'vs actual' : ''} <button className="link" onClick={onEdit}>Edit plan</button></h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th className="num">Plan</th>{hasActual && <th className="num">Actual</th>}</tr></thead>
              <tbody>
                {rows.map(([label, plan, actual, money]) => (
                  <tr key={label}><td>{label}</td><td className="num">{money ? rm(plan) : plan}</td>{hasActual && <td className="num">{money ? rm(actual) : actual}</td>}</tr>
                ))}
                <tr className="total">
                  <td>Net profit</td>
                  <td className={'num ' + tone(p.profit)}>{rm(p.profit)} <span className="muted small">({p.margin_pct}%)</span></td>
                  {hasActual && <td className={'num ' + tone(e.profit)}>{rm(e.profit)} <span className="muted small">({e.margin_pct}%)</span></td>}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="kpis">
            <div><span>Break-even price</span><b>{rm(p.break_even_price)}</b><small>{p.lines.length > 1 ? 'average per bottle' : 'per bottle'}</small></div>
            <div><span>Break-even bottles</span><b>{p.break_even_bottles ?? '–'}</b><small>at your planned price</small></div>
          </div>
        </div>

        <div className="card">
          <h2>Price scenarios <span className="muted small" style={{ fontWeight: 400 }}>at {p.bottles} bottles</span></h2>
          <div className="table-wrap">
            <table>
              <thead><tr>{p.lines.map((l) => <th key={l.size} className="num">{l.size} price</th>)}<th className="num">Net profit</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {p.scenarios.map((s) => (
                  <tr key={s.step} className={s.step === 0 ? 'current' : ''}>
                    {s.prices.map((pr, i) => <td key={i} className="num">{rm(pr)}</td>)}
                    <td className={'num ' + tone(s.profit)}>{rm(s.profit)}</td>
                    <td className="num">{s.margin_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>The highlighted row is your planned price. Costs stay the same; only the price changes.</p>
        </div>
      </div>

      <div className="card">
        <h2>Per bottle</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Size</th><th className="num">Target</th><th className="num">Price</th><th className="num">Cost / bottle</th><th className="num">Gross profit / bottle</th><th className="num">Gross margin</th>{upcoming && <th className="num">Stock now</th>}{upcoming && <th className="num">Left after</th>}</tr></thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.size}>
                  <td><b>{l.size}</b></td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{rm(l.price)}</td>
                  <td className="num">{l.cost ? <>{rm(l.cost)}<div className="muted small">{l.cost_source === 'event' ? 'set for this event' : 'from stock'}</div></> : <span className="badge warn">no cost yet</span>}</td>
                  <td className={'num ' + tone(l.gross_per_bottle)}>{rm(l.gross_per_bottle)}</td>
                  <td className="num">{l.gross_margin_pct}%</td>
                  {upcoming && <td className="num">{l.available}</td>}
                  {upcoming && <td className="num">{l.left_after < 0 ? <span className="badge out">{l.left_after}</span> : l.left_after}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>Cost / bottle is either set on this event's plan, or the blended cost of leftover stock and new restocks for that size (from Stock).</p>
      </div>
    </>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const st = useApi(`/events/${id}`);
  const settings = useApi('/settings');
  const [modal, setModal] = useState(null);
  const [showSales, setShowSales] = useState(false);

  const e = st.data;
  if (!e) return <Loading state={st} />;
  const close = (saved) => { setModal(null); if (saved) st.reload(); };

  const byProduct = Object.values(
    e.sales.reduce((m, s) => {
      const r = (m[s.product_name] ||= { name: s.product_name, qty: 0, revenue: 0, cogs: 0 });
      r.qty += s.qty; r.revenue += s.revenue; r.cogs += s.cogs;
      return m;
    }, {})
  ).sort((a, b) => b.qty - a.qty);

  const grossProfit = e.revenue - e.cogs;
  const finished = e.end_date < today();

  return (
    <>
      <p className="small" style={{ marginBottom: 8 }}><Link to="/events" className="muted">← All events</Link></p>
      <PageHead title={e.name} sub={`${e.location ? e.location + ' · ' : ''}${fmtDate(e.start_date)}${e.end_date !== e.start_date ? ' – ' + fmtDate(e.end_date) : ''}`}>
        <button onClick={() => setModal({ t: 'edit' })}>Edit event</button>
        <button onClick={() => setModal({ t: 'cost' })}>+ Add cost</button>
        <button className="primary" onClick={() => setModal({ t: 'sales' })}>Record sales</button>
      </PageHead>

      <div className="stats">
        <Stat label="Sales" value={rm(e.revenue)} sub={`${e.bottles} bottles`} />
        <Stat label="Net profit" value={rm(e.profit)} tone={tone(e.profit)} sub={e.revenue ? `${e.margin_pct}% margin · ${rm(e.profit_per_day)}/day` : 'No sales recorded yet'} />
        <Stat label="Cash result" value={rm(e.cash_result)} tone={tone(e.cash_result)} sub="Sales − wages, commission & booth costs" />
        <Stat label="Break-even" value={e.break_even_bottles ? `${e.break_even_bottles} bottles` : '–'} sub={e.break_even_bottles ? (e.bottles >= e.break_even_bottles ? 'Reached ✓' : `${e.break_even_bottles - e.bottles} more to cover costs`) : 'Needs some sales to estimate'} />
      </div>
      {e.break_even_bottles ? (
        <div className="bar" style={{ marginTop: 10 }}><div style={{ width: Math.min(100, (e.bottles / e.break_even_bottles) * 100) + '%' }} /></div>
      ) : null}

      <PlanSection e={e} onEdit={() => setModal({ t: 'edit' })} />

      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <h2>Costing summary</h2>
          <table>
            <tbody>
              <tr><td>Sales ({e.bottles} bottles)</td><td className="num">{rm(e.revenue)}</td></tr>
              <tr className="sub"><td>− Cost of bottles sold <span className="small">(avg stock cost)</span></td><td className="num">{rm(e.cogs)}</td></tr>
              <tr className="total"><td>Gross profit</td><td className="num">{rm(grossProfit)}</td></tr>
              <tr className="sub"><td>− Worker wages <span className="small">({e.worker_days} day(s) × {rm(e.daily_wage)})</span></td><td className="num">{rm(e.wages)}</td></tr>
              <tr className="sub"><td>− Worker commission <span className="small">({rm(e.commission_rate)} × bottles)</span></td><td className="num">{rm(e.commission)}</td></tr>
              <tr className="sub"><td>− Booth &amp; other costs</td><td className="num">{rm(e.other_costs)}</td></tr>
              <tr className="total"><td>Net profit</td><td className={'num ' + tone(e.profit)}>{rm(e.profit)}</td></tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>Unsold bottles are not counted as a cost. They stay in stock at their original cost.</p>
        </div>

        <div className="card">
          <h2>Booth &amp; other costs</h2>
          {e.costs.length === 0 ? <Empty>No costs yet. Add the booth fee, transport, etc.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Cost</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {e.costs.map((c) => (
                    <tr key={c.id}>
                      <td>{c.category}<div className="muted small">{c.description}</div></td>
                      <td className={'num' + (c.amount < 0 ? ' pos' : '')}>{c.amount < 0 ? '+' + rm(-c.amount) : rm(c.amount)}</td>
                      <td className="right nowrap">
                        <button className="link" onClick={() => setModal({ t: 'cost', cost: c })}>Edit</button>
                        <button className="link danger" onClick={async () => (await confirmDelete('Delete this cost?', () => api(`/costs/${c.id}`, { method: 'DELETE' }))) && st.reload()}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td className="num">{rm(e.other_costs)}</td><td /></tr></tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>
          Sales by product
          {e.sales.length > 0 && <button className="link" onClick={() => setShowSales((s) => !s)}>{showSales ? 'Hide' : 'Show'} individual entries</button>}
        </h2>
        {byProduct.length === 0 ? <Empty>{finished ? 'No sales recorded for this event.' : 'Record sales after each booth day.'}</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th className="num">Bottles</th><th className="num">Sales</th><th className="num">Cost</th><th className="num">Gross profit</th></tr></thead>
              <tbody>
                {byProduct.map((r) => (
                  <tr key={r.name}><td>{r.name}</td><td className="num">{r.qty}</td><td className="num">{rm(r.revenue)}</td><td className="num">{rm(r.cogs)}</td><td className="num">{rm(r.revenue - r.cogs)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showSales && (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table>
              <thead><tr><th>Date</th><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th /></tr></thead>
              <tbody>
                {e.sales.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap">{fmtDate(s.date)}</td><td>{s.product_name}</td><td className="num">{s.qty}</td><td className="num">{rm(s.unit_price)}</td>
                    <td className="right"><button className="link danger" onClick={async () => (await confirmDelete('Delete this sale entry?', () => api(`/sales/${s.id}`, { method: 'DELETE' }))) && st.reload()}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ marginTop: 16 }}>
        <button className="link danger" onClick={async () => (await confirmDelete('Delete this event and its costs?', () => api(`/events/${e.id}`, { method: 'DELETE' }))) && nav('/events')}>Delete event</button>
      </p>

      {modal?.t === 'edit' && <EventModal event={e} settings={settings.data} onClose={close} />}
      {modal?.t === 'cost' && <CostModal eventId={e.id} cost={modal.cost} defaultDate={e.start_date} lastDate={e.end_date} onClose={close} />}
      {modal?.t === 'sales' && <SalesEntry eventId={e.id} channel="booth" onClose={close} />}
    </>
  );
}
