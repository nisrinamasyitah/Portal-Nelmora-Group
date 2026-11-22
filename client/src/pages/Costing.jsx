import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, confirmDelete, useApi } from '../components.jsx';
import { fmtDate, rm, today } from '../utils.js';

// Costing sheets: the Excel costing sheet inside the portal, for any period (direct selling, restock, or an event).

const SIZES = ['30ml', '10ml'];
const period = (s) => `${fmtDate(s.start_date)} – ${s.end_date ? fmtDate(s.end_date) : 'today'}`;
const rm4 = (n) => 'RM ' + Number(n || 0).toFixed(2);
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

// ---------------------------------------------------------------- modals
function SheetModal({ sheet, nextCode, onClose }) {
  const events = useApi('/events');
  const [f, setF] = useState(sheet
    ? { code: sheet.code, title: sheet.title, start_date: sheet.start_date, end_date: sheet.end_date || '', event_id: sheet.event_id || '', note: sheet.note || '' }
    : { code: nextCode, title: '', start_date: today(), end_date: '', event_id: '', note: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => (sheet ? api(`/costing/${sheet.id}`, { method: 'PUT', body: f }) : api('/costing', { method: 'POST', body: f }));
  return (
    <FormModal title={sheet ? `Edit costing ${sheet.code}` : 'New costing sheet'} onClose={onClose} onSave={save}>
      <div className="row">
        <Field label="Number"><input value={f.code} onChange={(e) => set('code', e.target.value)} required style={{ maxWidth: 120 }} /></Field>
        <Field label="Title"><input value={f.title} onChange={(e) => set('title', e.target.value)} required autoFocus placeholder="e.g. Direct selling (Nov 2026)" /></Field>
      </div>
      <div className="row">
        <Field label="Start date"><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} required /></Field>
        <Field label="End date" hint="Leave empty while it's still running (counts up to today)."><input type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
      </div>
      <Field label="Event (optional)" hint="No event = direct selling sheet: it counts sales outside events. With an event: it counts that event's sales and costs.">
        <select value={f.event_id} onChange={(e) => set('event_id', e.target.value)}>
          <option value="">No event (direct selling / restock)</option>
          {(events.data || []).map((e) => <option key={e.id} value={e.id}>{e.name} · {e.start_date}</option>)}
        </select>
      </Field>
      <Field label="Note"><input value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
    </FormModal>
  );
}

const PARTS = { '30ml': ['Perfume + bottle (full set)', 'Sticker / label', 'Packaging box'], '10ml': ['Perfume + bottle', 'Sticker / label', 'Packaging box'] };

function RestockModal({ sheet, onClose }) {
  const stock = useApi('/stock');
  const [size, setSize] = useState('30ml');
  const [date, setDate] = useState(today());
  const [supplier, setSupplier] = useState('');
  const [cash, setCash] = useState(true);
  const [parts, setParts] = useState(PARTS['30ml'].map((name) => ({ name, cost: '', qty: '' })));
  const [qty, setQty] = useState({});
  const setPart = (i, k, v) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const per = parts.map((p) => (Number(p.qty) > 0 ? (Number(p.cost) || 0) / Number(p.qty) : 0));
  const unit = per.reduce((a, b) => a + b, 0);
  const scents = (stock.data || []).filter((p) => p.active && p.line === size && (p.gender === 'Men' || p.gender === 'Women'));
  const bottles = scents.reduce((a, p) => a + (Number(qty[p.id]) || 0), 0);
  const changeSize = (s) => { setSize(s); setQty({}); setParts(PARTS[s].map((name, i) => ({ name, cost: parts[i]?.cost || '', qty: parts[i]?.qty || '' }))); };
  const save = () => api(`/costing/${sheet.id}/restock`, { method: 'POST', body: {
    date, size, supplier, cash_paid: cash, parts, items: Object.entries(qty).map(([product_id, q]) => ({ product_id, qty: q })),
  } });
  return (
    <FormModal title={`Restock · costing ${sheet.code}`} saveLabel={`Add ${bottles} bottle${bottles === 1 ? '' : 's'}`} wide onClose={onClose} onSave={save}>
      <div className="row3">
        <Field label="Size">
          <div className="seg">{SIZES.map((s) => <button type="button" key={s} className={size === s ? 'on' : ''} onClick={() => changeSize(s)}>{s}</button>)}</div>
        </Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Supplier"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="optional" /></Field>
      </div>
      <div className="sheet-sub">Cost per bottle (like section 2 of the sheet)</div>
      <table className="compact sheet-table">
        <thead><tr><th>Description</th><th className="num">Batch cost (RM)</th><th className="num">Batch qty (btl)</th><th className="num">Per bottle</th></tr></thead>
        <tbody>
          {parts.map((p, i) => (
            <tr key={i}>
              <td><input value={p.name} onChange={(e) => setPart(i, 'name', e.target.value)} /></td>
              <td><input className="num" type="number" min="0" step="0.01" value={p.cost} onChange={(e) => setPart(i, 'cost', e.target.value)} /></td>
              <td><input className="num" type="number" min="0" step="1" value={p.qty} onChange={(e) => setPart(i, 'qty', e.target.value)} /></td>
              <td className="num">{per[i] ? rm4(per[i]) : '–'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={3}>New batch cost / bottle</td><td className="num"><b>{rm4(unit)}</b></td></tr></tfoot>
      </table>
      <div className="sheet-sub">Bottles per scent ({size})</div>
      {!stock.data ? <Loading state={stock} /> : (
        <div className="scent-qty">
          {scents.map((p) => (
            <label key={p.id}><span>{p.name.replace(/ \((10|30)ml\)$/, '')} <span className="muted small">{p.on_hand} now</span></span>
              <input type="number" min="0" step="1" value={qty[p.id] || ''} onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))} placeholder="0" />
            </label>
          ))}
        </div>
      )}
      <p className="small" style={{ margin: '12px 0' }}><b>{bottles}</b> bottles × {rm4(unit)} = <b>{rm(bottles * unit)}</b></p>
      <label className="check"><input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} /> <span>Paid with cash now (shows in Cash flow as a stock purchase). Untick for stock you already owned.</span></label>
    </FormModal>
  );
}

function CostModal({ sheet, onClose }) {
  const [f, setF] = useState({ date: today(), description: '', amount: '' });
  return (
    <FormModal title={`Add cost · costing ${sheet.code}`} onClose={onClose} onSave={() => api(`/costing/${sheet.id}/costs`, { method: 'POST', body: f })}>
      <p className="muted small" style={{ marginBottom: 12 }}>A running cost for this period (e.g. postage, Shopee fee, packaging). It's added to Cash flow as money out.</p>
      <Field label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required autoFocus placeholder="e.g. Postage" /></Field>
      <div className="row">
        <Field label="Amount (RM)"><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------- list
export default function Costing() {
  const list = useApi('/costing');
  const [modal, setModal] = useState(false);
  const nav = useNavigate();
  if (!list.data) return <Loading state={list} />;
  const rows = list.data.rows;
  return (
    <>
      <PageHead title="Costing" sub="Your costing sheets in the portal: leftover stock, restock, costs, sales and profit for any period, with or without an event.">
        <button className="primary" onClick={() => setModal(true)}>+ New costing sheet</button>
      </PageHead>
      <div className="card">
        {rows.length === 0 ? <Empty>No costing sheets yet. Start one for your direct selling or next restock — e.g. "{list.data.next_code} · Direct selling (Nov 2026)".</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>No.</th><th>Costing</th><th>Period</th><th className="num">Bottles sold</th><th className="num">Sales</th><th className="num">Net profit</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => nav(`/costing/${s.id}`)}>
                    <td><b>{s.code}</b></td>
                    <td><b>{s.title}</b><div className="row-note">{s.event_name ? `Event: ${s.event_name}` : 'Direct selling / restock'}{s.restocks ? ` · ${s.restocks} restock${s.restocks === 1 ? '' : 's'}` : ''}</div></td>
                    <td className="nowrap">{period(s)}</td>
                    <td className="num">{s.result.bottles}</td>
                    <td className="num">{rm(s.result.sales)}</td>
                    <td className={'num ' + (s.result.profit >= 0 ? 'pos' : 'neg')}>{rm(s.result.profit)}</td>
                    <td className="right"><Link to={`/costing/${s.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal && <SheetModal nextCode={list.data.next_code} onClose={(saved) => { setModal(false); if (saved) list.reload(); }} />}
    </>
  );
}

// ---------------------------------------------------------------- one sheet
function Section({ n, title, children, right }) {
  return (
    <div className="card sheet-section">
      <h2><span><span className="sheet-n">{n}</span>{title}</span>{right}</h2>
      {children}
    </div>
  );
}

export function CostingSheet() {
  const { id } = useParams();
  const r = useApi(`/costing/${id}`);
  const nav = useNavigate();
  const [modal, setModal] = useState(null);
  const close = (saved) => { setModal(null); if (saved) r.reload(); };
  if (!r.data) return <Loading state={r} />;
  const { sheet, lines, groups, fixed, result, scenario, ledger, sales_note } = r.data;
  const L = Object.fromEntries(lines.map((l) => [l.size, l]));

  return (
    <>
      <PageHead title={`${sheet.code} · ${sheet.title}`} sub={`${period(sheet)}${sheet.event_name ? ` · Event: ${sheet.event_name}` : ' · Direct selling / restock'}`}>
        <button onClick={() => setModal('edit')}>Edit</button>
        <button onClick={() => setModal('cost')}>+ Add cost</button>
        <button className="primary" onClick={() => setModal('restock')}>+ Add restock</button>
      </PageHead>
      <p className="muted small" style={{ marginTop: -8 }}><Link to="/costing">← All costing sheets</Link></p>

      <div className="sheet-grid">
        <Section n="1" title="Leftover stock at the start">
          <table className="compact sheet-table">
            <thead><tr><th /><th className="num">Bottles</th><th className="num">Cost / bottle</th><th className="num">Value</th></tr></thead>
            <tbody>{SIZES.map((s) => <tr key={s}><td><b>{s}</b></td><td className="num">{L[s].leftover.qty}</td><td className="num">{rm4(L[s].leftover.cost)}</td><td className="num">{rm(L[s].leftover.value)}</td></tr>)}</tbody>
          </table>
          <p className="muted small">Stock on hand on {fmtDate(sheet.start_date)}, at its moving-average cost.</p>
        </Section>

        <Section n="3" title="Combined stock & blended cost">
          <table className="compact sheet-table">
            <thead><tr><th /><th className="num">Bottles available</th><th className="num">Blended cost / bottle</th></tr></thead>
            <tbody>{SIZES.map((s) => <tr key={s}><td><b>{s}</b></td><td className="num">{L[s].combined.qty}</td><td className="num"><b>{rm4(L[s].combined.cost)}</b></td></tr>)}</tbody>
          </table>
          <p className="muted small">Leftover + new restock, blended as a weighted average.</p>
        </Section>
      </div>

      <Section n="2" title="New restock" right={<button className="link" onClick={() => setModal('restock')}>+ Add restock</button>}>
        <div className="sheet-grid" style={{ marginBottom: groups.length ? 14 : 0 }}>
          {SIZES.map((s) => (
            <div key={s} className="sheet-kpi"><span className="muted small">{s} restocked</span><b>{L[s].restock.qty} bottles</b><span className="muted small">{L[s].restock.qty ? `${rm4(L[s].restock.cost)} / bottle · ${rm(L[s].restock.value)}` : 'none in this period'}</span></div>
          ))}
        </div>
        {groups.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No restock in this period yet.</p> : groups.map((g) => (
          <div key={g.id} className="restock-group">
            <div className="restock-head">
              <b>{fmtDate(g.date)} · {g.size} restock</b>
              <span className="muted small">{g.supplier ? `${g.supplier} · ` : ''}{g.cash_paid ? 'paid with cash' : 'already owned'}</span>
              <button className="link danger" onClick={async () => (await confirmDelete('Delete this restock? Its bottles are removed from stock (and Cash flow).', () => api(`/costing/restock/${g.id}`, { method: 'DELETE' }))) && r.reload()}>Delete</button>
            </div>
            <table className="compact sheet-table">
              <thead><tr><th>Description</th><th className="num">Batch cost</th><th className="num">Batch qty</th><th className="num">Per bottle</th></tr></thead>
              <tbody>{g.parts.map((p, i) => <tr key={i}><td>{p.name}</td><td className="num">{rm(p.cost)}</td><td className="num">{p.qty}</td><td className="num">{rm4(p.cost / p.qty)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Cost / bottle</td><td className="num"><b>{rm4(g.unit_cost)}</b></td></tr></tfoot>
            </table>
            <p className="small" style={{ margin: '8px 0 0' }}>{g.items.map((i) => `${i.name.replace(/ \((10|30)ml\)$/, '')} × ${i.qty}`).join(' · ')} — <b>{g.items.reduce((a, i) => a + i.qty, 0)} bottles</b></p>
          </div>
        ))}
      </Section>

      <div className="sheet-grid">
        <Section n="4" title="Fixed costs" right={<button className="link" onClick={() => setModal('cost')}>+ Add cost</button>}>
          {fixed.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No fixed costs{sheet.event_name ? '' : ' (direct selling usually has none — add postage or fees if any)'}.</p> : (
            <table className="compact sheet-table">
              <tbody>{fixed.map((x) => (
                <tr key={x.id}><td>{x.description}{x.from_event && <span className="muted small"> · event</span>}</td><td className="num">{rm(x.amount)}</td>
                  <td className="right">{!x.from_event && <button className="link danger" onClick={async () => (await confirmDelete('Delete this cost? It is also removed from Cash flow.', () => api(`/costing/costs/${x.id}`, { method: 'DELETE' }))) && r.reload()}>Delete</button>}</td></tr>
              ))}</tbody>
              <tfoot><tr><td>Total fixed cost</td><td className="num">{rm(result.fixed)}</td><td /></tr></tfoot>
            </table>
          )}
        </Section>

        <Section n="5" title="Sold in this period">
          <table className="compact sheet-table">
            <thead><tr><th /><th className="num">Bottles</th><th className="num">Avg price</th><th className="num">Sales</th></tr></thead>
            <tbody>{SIZES.map((s) => <tr key={s}><td><b>{s}</b></td><td className="num">{L[s].sold.qty}</td><td className="num">{L[s].sold.qty ? rm(L[s].sold.price) : '–'}</td><td className="num">{rm(L[s].sold.revenue)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{result.bottles}</td><td /><td className="num">{rm(result.sales)}</td></tr></tfoot>
          </table>
          <p className="muted small">{sales_note}. Remaining now: 30ml {L['30ml'].remaining} · 10ml {L['10ml'].remaining}.</p>
        </Section>
      </div>

      <Section n="6" title="Result — cost & profit (30ml + 10ml combined)">
        <div className="result-grid">
          {[
            ['Total fixed cost', rm(result.fixed)],
            ['Total variable cost', rm(result.variable), 'cost of bottles sold'],
            ['Total cost', rm(result.total)],
            ['Total sale', rm(result.sales)],
            ['Net profit', rm(result.profit), null, true],
            ['Net profit margin', pct(result.margin_pct), null, true],
            ['Gross profit / bottle', rm(result.gross_per_bottle)],
            ['Gross margin', pct(result.gross_margin_pct)],
            ['Break-even price / bottle', rm(result.break_even_price)],
            ['Break-even bottles', result.break_even_bottles || '–', 'at the prices sold'],
          ].map(([k, v, sub, key]) => (
            <div key={k} className={'result-cell' + (key ? ' key' : '')}><span>{k}</span><b className={key && result.profit < 0 ? 'neg' : ''}>{v}</b>{sub && <small>{sub}</small>}</div>
          ))}
        </div>
      </Section>

      <Section n="7" title="Price scenario (at the bottles sold)">
        {result.bottles === 0 ? <p className="muted small" style={{ margin: 0 }}>Shows once there are sales in this period.</p> : (
          <table className="compact sheet-table">
            <thead><tr><th className="num">30ml price</th><th className="num">10ml price</th><th className="num">Sales</th><th className="num">Net profit</th><th className="num">Margin</th></tr></thead>
            <tbody>{scenario.map((x) => (
              <tr key={x.step} className={x.step === 0 ? 'current' : ''}>
                <td className="num">{L['30ml'].sold.qty ? rm(x.prices['30ml']) : '–'}</td><td className="num">{L['10ml'].sold.qty ? rm(x.prices['10ml']) : '–'}</td>
                <td className="num">{rm(x.sales)}</td><td className={'num ' + (x.profit >= 0 ? 'pos' : 'neg')}>{rm(x.profit)}</td><td className="num">{pct(x.margin_pct)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>

      <Section n="📦" title="Stock ledger — in and out per scent">
        <div className="sheet-grid">
          {ledger.map((g) => (
            <div key={g.size}>
              <div className="sheet-sub">{g.size}</div>
              <table className="compact sheet-table">
                <thead><tr><th>Scent</th><th className="num">Opening</th><th className="num">In</th><th className="num">Sold</th><th className="num">Out</th><th className="num">Closing</th></tr></thead>
                <tbody>{g.rows.map((x) => (
                  <tr key={x.product_id} style={x.catalog ? undefined : { opacity: 0.55 }}>
                    <td>{x.name}</td><td className="num muted">{x.opening}</td>
                    <td className={'num ' + (x.in ? 'pos' : 'muted')}>{x.in ? `+${x.in}` : 0}</td>
                    <td className={'num ' + (x.sold ? 'neg' : 'muted')}>{x.sold ? `−${x.sold}` : 0}</td>
                    <td className={'num ' + (x.out ? 'neg' : 'muted')}>{x.out ? `−${x.out}` : 0}</td>
                    <td className="num"><b>{x.closing}</b></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr>
                  <td>Total</td>
                  {['opening', 'in', 'sold', 'out', 'closing'].map((k) => <td key={k} className="num">{g.rows.filter((x) => x.catalog).reduce((a, x) => a + x[k], 0)}</td>)}
                </tr></tfoot>
              </table>
            </div>
          ))}
        </div>
        <p className="muted small">In = restocks and stock-count additions. Out = write-offs (testers, damaged, gifts) and stock-count reductions. Sold counts every sale in the period.</p>
      </Section>

      <p style={{ marginTop: 16 }}>
        <button className="link danger" onClick={async () => (await confirmDelete(`Delete costing ${sheet.code}? (Only possible when it has no restocks or costs.)`, () => api(`/costing/${sheet.id}`, { method: 'DELETE' }))) && nav('/costing')}>Delete this costing sheet</button>
      </p>

      {modal === 'edit' && <SheetModal sheet={sheet} onClose={close} />}
      {modal === 'restock' && <RestockModal sheet={sheet} onClose={close} />}
      {modal === 'cost' && <CostModal sheet={sheet} onClose={close} />}
    </>
  );
}
