import { useState } from 'react';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, Stat, confirmDelete, useApi } from '../components.jsx';
import { fmtDate, monthLabel, rm, today } from '../utils.js';

function ProductModal({ product, onClose }) {
  const [f, setF] = useState(product || { name: '', line: '10ml', gender: '', price: 25, reorder_level: 10, active: 1, notes: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => (product ? api(`/products/${product.id}`, { method: 'PUT', body: f }) : api('/products', { method: 'POST', body: f }));
  return (
    <FormModal title={product ? 'Edit product' : 'Add product'} onClose={onClose} onSave={save}>
      <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus placeholder="e.g. Horizon" /></Field>
      <div className="row">
        <Field label="Size / line">
          <select value={f.line} onChange={(e) => { const line = e.target.value; setF((x) => ({ ...x, line, price: x.price === 25 && line === '30ml' ? 65 : x.price === 65 && line === '10ml' ? 25 : x.price })); }}>
            <option>10ml</option><option>30ml</option><option>Other</option>
          </select>
        </Field>
        <Field label="For">
          <select value={f.gender} onChange={(e) => set('gender', e.target.value)}>
            <option value="">Not set</option><option>Women</option><option>Men</option><option>Unisex</option>
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Retail price (RM)"><input type="number" step="0.01" min="0" value={f.price} onChange={(e) => set('price', e.target.value)} required /></Field>
        <Field label="Reorder level" hint="Shows 'low' when stock is below this number."><input type="number" min="0" value={f.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} /></Field>
      </div>
      <Field label="Scent notes" hint="From your catalog, e.g. Calabrian Bergamot, Patchouli"><input value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={!!f.active} onChange={(e) => set('active', e.target.checked)} /> Active (untick to hide from sales entry)</label>
    </FormModal>
  );
}

// Cost per bottle from production parts, like the costing sheet:
// each part's batch cost ÷ batch quantity, added together.
const PARTS = ['Perfume + bottle', 'Sticker / label', 'Packaging box'];
const r4 = (n) => Math.round(n * 10000) / 10000; // keep sen-level accuracy, like the sheet

function PartsCalculator({ onApply }) {
  const [rows, setRows] = useState(PARTS.map((name) => ({ name, cost: '', qty: '' })));
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const per = rows.map((r) => (Number(r.qty) > 0 ? (Number(r.cost) || 0) / Number(r.qty) : 0));
  const unit = r4(per.reduce((a, b) => a + b, 0));
  const used = rows.filter((r) => Number(r.cost) > 0 && Number(r.qty) > 0);
  const apply = () => onApply({
    unit_cost: unit,
    qty: rows[0].qty,
    note: 'Parts: ' + used.map((r) => `${r.name} RM${r.cost}/${r.qty}`).join(', '),
  });
  return (
    <div className="parts">
      <div className="parts-grid">
        <span className="muted small">Part</span><span className="muted small">Batch cost (RM)</span><span className="muted small">Batch qty</span><span className="muted small num">Per bottle</span>
        {rows.map((r, i) => (
          <div key={r.name} style={{ display: 'contents' }}>
            <span>{r.name}</span>
            <input type="number" min="0" step="0.01" value={r.cost} onChange={(e) => setRow(i, 'cost', e.target.value)} aria-label={`${r.name} batch cost`} />
            <input type="number" min="0" step="1" value={r.qty} onChange={(e) => setRow(i, 'qty', e.target.value)} aria-label={`${r.name} batch quantity`} />
            <span className="num">{per[i] ? rm(per[i]) : '–'}</span>
          </div>
        ))}
      </div>
      <div className="parts-foot">
        <span>Cost per bottle: <b>RM {unit.toFixed(4)}</b></span>
        <button type="button" onClick={apply} disabled={!unit}>Use this cost</button>
      </div>
    </div>
  );
}

function BatchModal({ products, onClose }) {
  const [f, setF] = useState({ product_id: products[0]?.id || '', date: today(), qty: '', unit_cost: '', supplier: '', note: '', cash_paid: true });
  const [calc, setCalc] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const total = (Number(f.qty) || 0) * (Number(f.unit_cost) || 0);
  return (
    <FormModal title="Add stock (production / restock)" wide onClose={onClose} onSave={() => api('/batches', { method: 'POST', body: { ...f, cash_paid: f.cash_paid ? 1 : 0 } })}>
      <Field label="Product">
        <select value={f.product_id} onChange={(e) => set('product_id', e.target.value)} required>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <div className="row3">
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></Field>
        <Field label="Bottles"><input type="number" min="1" step="1" value={f.qty} onChange={(e) => set('qty', e.target.value)} required autoFocus /></Field>
        <Field label="Cost / bottle (RM)"><input type="number" min="0" step="any" value={f.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} required /></Field>
      </div>
      <p className="muted small" style={{ margin: '-4px 0 12px' }}>
        Total: <b>{rm(total)}</b> ·{' '}
        <button type="button" className="link" style={{ padding: 0 }} onClick={() => setCalc((c) => !c)}>
          {calc ? 'Hide cost calculator' : 'Work out cost / bottle from parts'}
        </button>
      </p>
      {calc && <PartsCalculator onApply={(v) => { setF((x) => ({ ...x, ...v, qty: x.qty || v.qty, note: x.note || v.note })); setCalc(false); }} />}
      <Field label="Supplier"><input value={f.supplier} onChange={(e) => set('supplier', e.target.value)} placeholder="e.g. MYPARFUME" /></Field>
      <Field label="Note"><input value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
      <label className="check">
        <input type="checkbox" checked={f.cash_paid} onChange={(e) => set('cash_paid', e.target.checked)} />
        <span>Paid with cash now. Untick for <b>opening / carried-forward stock</b> you already own, so it doesn't show as money going out.</span>
      </label>
    </FormModal>
  );
}

// Stock levels are grouped by size, then Men / Women. 
// Catalog scents are the products marked Men or Women. Anything else (e.g. "30ml (scent not recorded)", used for past
// sales where the sheets didn't record a scent) stays in the history but is not listed in Stock levels.
const isCatalog = (p) => p.gender === 'Men' || p.gender === 'Women';

const dayMonth = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const KIND_LABEL = { sold: 'Sold', restock: 'Restock', count: 'Stock count', 'write-off': 'Write-off' };

// Latest update per scent, laid out like the stock table: Before → + / − → Now, and the date.
function LatestUpdate({ list, size }) {
  return (
    <>
      <h3 className="sub-h" style={{ margin: '22px 0 10px' }}>Latest update per scent · {size}</h3>
      <div className="stock-cols">
        {['Men', 'Women'].map((gender) => {
          const items = list.filter((p) => p.line === size && p.gender === gender);
          return (
            <div key={gender} className="stock-col">
              <div className="stock-col-head"><b>{gender}</b></div>
              <table className="compact">
                <thead><tr><th>Scent</th><th className="num">Before</th><th className="num">+ / −</th><th className="num">Now</th><th className="right">Date</th></tr></thead>
                <tbody>
                  {items.map((p) => {
                    const has = p.last_date && p.prev_on_hand != null;
                    const diff = has ? p.on_hand - p.prev_on_hand : 0;
                    return (
                      <tr key={p.id} title={has ? p.last_kinds.map((k) => KIND_LABEL[k] || k).join(' + ') : ''}>
                        <td>{p.name.replace(/ \((10|30)ml\)$/, '')}</td>
                        <td className="num muted">{has ? p.prev_on_hand : '–'}</td>
                        <td className={'num ' + (diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'muted')}>{diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : '0'}</td>
                        <td className="num"><b>{p.on_hand}</b></td>
                        <td className="right muted nowrap">{has ? dayMonth(p.last_date) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CountModal({ product, onClose }) {
  const [f, setF] = useState({ date: today(), count: product.on_hand });
  const diff = (Number(f.count) || 0) - product.on_hand;
  return (
    <FormModal title={`Set count · ${product.name}`} saveLabel="Save count" onClose={onClose}
      onSave={() => api('/stock-count', { method: 'POST', body: { product_id: product.id, date: f.date, count: f.count } })}>
      <p className="muted small" style={{ marginBottom: 12 }}>Type the number of bottles you counted. Only the stock number changes; profit and cash flow are not affected.</p>
      <div className="row">
        <Field label="Bottles counted"><input type="number" min="0" step="1" value={f.count} onChange={(e) => setF((x) => ({ ...x, count: e.target.value }))} required autoFocus /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} required /></Field>
      </div>
      <p className="small">Now {product.on_hand} → <b>{Number(f.count) || 0}</b> {diff ? <span className={diff > 0 ? 'pos' : 'neg'}>({diff > 0 ? '+' : ''}{diff})</span> : <span className="muted">(no change)</span>}</p>
    </FormModal>
  );
}

const REASONS = ['Tester', 'Damaged', 'Gift / giveaway', 'Lost', 'Other'];
function AdjModal({ products, onClose }) {
  const [f, setF] = useState({ product_id: products[0]?.id || '', date: today(), qty: '', reason: REASONS[0], note: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <FormModal title="Write off stock" onClose={onClose} onSave={() => api('/adjustments', { method: 'POST', body: f })}>
      <p className="muted small" style={{ marginBottom: 12 }}>For bottles that leave stock without a sale. Their cost is counted as a loss in that month.</p>
      <Field label="Product">
        <select value={f.product_id} onChange={(e) => set('product_id', e.target.value)} required>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <div className="row3">
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></Field>
        <Field label="Bottles"><input type="number" min="1" step="1" value={f.qty} onChange={(e) => set('qty', e.target.value)} required autoFocus /></Field>
        <Field label="Reason"><select value={f.reason} onChange={(e) => set('reason', e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
      </div>
      <Field label="Note"><input value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
    </FormModal>
  );
}

export default function Stock() {
  const stock = useApi('/stock');
  const batches = useApi('/batches');
  const adjs = useApi('/adjustments');  const [tab, setTab] = useState('levels');
  const [size, setSize] = useState('30ml');
  const [prodMonth, setProdMonth] = useState('');
  const [modal, setModal] = useState(null); // {type, product?}

  const reloadAll = () => { stock.reload(); batches.reload(); adjs.reload(); };
  const close = (saved) => { setModal(null); if (saved) reloadAll(); };

  if (!stock.data) return <Loading state={stock} />;
  // Stock tracker shows catalog scents only.
  const list = stock.data.filter(isCatalog);
  const ids = new Set(list.map((p) => p.id));
  // Production history shows every batch: catalog scents plus the production/restock recorded in costing sheets 0001–0004.
  // Stock counts (bottles already owned) are not production, so they're kept for stock levels but not listed here.
  const batchRows = [...(batches.data || [])].filter((b) => !/^(Leftover count|Stock count)/.test(b.note || '')).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const fromSheet = (b) => /^\d{4} sheet/.test(b.note || '');
  const batchSize = (b) => (/10ml/.test(b.product_name) ? '10ml' : '30ml');
  // Production history grouped by month; batches from the same restock (same date, size, cost and note) become one line.
  const batchMonths = (() => {
    const groups = new Map();
    for (const b of batchRows) {
      const size = batchSize(b);
      const key = [b.date, size, b.unit_cost, (b.note || '').split(':')[0], b.cash_paid].join('|');
      const sheet = (b.note || '').match(/^(\d{4}) sheet/)?.[1];
      const g = groups.get(key) || {
        key, date: b.date, size, cost: b.unit_cost, qty: 0, ids: [], scents: [], sheet, cash: !!b.cash_paid,
        title: sheet ? `${sheet} costing sheet ${/restock/.test(b.note) ? 'restock' : 'production'}` : /^Leftover count/.test(b.note || '') ? 'Stock count (bottles already owned)' : 'Restock',
        note: (b.note || '').replace(/^[^:]*:\s*/, '').replace(/ \(dated on the event.*$/, ''),
      };
      g.qty += b.qty; g.ids.push(b.id);
      if (!/scent not recorded/.test(b.product_name)) g.scents.push({ name: b.product_name.replace(/ \((10|30)ml\)$/, ''), qty: b.qty, cost: b.unit_cost });
      groups.set(key, g);
    }
    const byMonth = new Map();
    for (const g of groups.values()) {
      g.detail = g.scents.length ? `${g.scents.length} scent${g.scents.length > 1 ? 's' : ''}` : g.note;
      const m = g.date.slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) || []), g]);
    }
    return [...byMonth].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  })();
  const shownMonths = batchMonths.filter(([m]) => !prodMonth || m === prodMonth);
  const shownGroups = shownMonths.flatMap(([, g]) => g);
  const adjRows = (adjs.data || []).filter((a) => ids.has(a.product_id));
  const active = list.filter((p) => p.active);
  const units = list.reduce((a, p) => a + Math.max(p.on_hand, 0), 0);
  const value = list.reduce((a, p) => a + p.stock_value, 0);
  const lowList = list.filter((p) => p.low).sort((a, b) => a.on_hand - b.on_hand);
  const low = lowList.length;
  const SIZES = ['30ml', '10ml'];
  // Last update = the latest day any catalog scent's stock changed, and what changed that day.
  const lastDate = list.reduce((a, p) => (p.last_date && p.last_date > a ? p.last_date : a), '');  const bySize = (z) => {
    const l = list.filter((p) => p.line === z);
    return { units: l.reduce((a, p) => a + Math.max(p.on_hand, 0), 0), value: l.reduce((a, p) => a + p.stock_value, 0) };
  };

  return (
    <>
      <PageHead title="Stock" sub={<>Bottles on hand per scent. Sales reduce the count automatically; restocks add to it.{lastDate && <><br /><span className="last-update">Last update: <b>{fmtDate(lastDate)}</b></span></>}</>}>
        <button onClick={() => setModal({ type: 'product' })}>+ Add product</button>
        <button onClick={() => setModal({ type: 'adj' })} disabled={!active.length}>Write off stock</button>
        <button className="primary" onClick={() => setModal({ type: 'batch' })} disabled={!active.length}>+ Add stock</button>
      </PageHead>

      <div className="stats">
        <Stat label="Bottles on hand" value={units} sub={SIZES.map((z) => `${bySize(z).units} × ${z}`).join(' · ')} />
        <Stat label="Stock value (at cost)" value={rm(value)} sub={SIZES.map((z) => `${z} ${rm(bySize(z).value)}`).join(' · ')} />
        <Stat
          label="Low stock"
          value={low ? `${low} scent${low > 1 ? 's' : ''}` : 'None'}
          tone={low ? 'neg' : 'pos'}
          sub={low ? 'Below 5 bottles' : 'All scents have 5 or more bottles'}
        />
      </div>

      <div className="card">
        <div className="tabs">
          <button className={tab === 'levels' ? 'on' : ''} onClick={() => setTab('levels')}>Stock levels</button>
          <button className={tab === 'batches' ? 'on' : ''} onClick={() => setTab('batches')}>Production history</button>
          <button className={tab === 'adj' ? 'on' : ''} onClick={() => setTab('adj')}>Write-offs</button>
        </div>

        {tab === 'levels' && (
          <>
            <div className="size-switch">
              <div className="seg">
                {['30ml', '10ml'].map((s) => {
                  const n = list.filter((p) => p.line === s).reduce((a, p) => a + Math.max(p.on_hand, 0), 0);
                  return <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)}>{s} <span className="seg-count">{n}</span></button>;
                })}
              </div>
              <span className="muted small">{rm(list.find((p) => p.line === size)?.price || 0)} each · {list.filter((p) => p.line === size).length} scents</span>
            </div>
            <div className="stock-cols">
              {['Men', 'Women'].map((gender) => {
                const items = list.filter((p) => p.line === size && p.gender === gender);
                const gUnits = items.reduce((a, p) => a + Math.max(p.on_hand, 0), 0);
                const gValue = items.reduce((a, p) => a + p.stock_value, 0);
                return (
                  <div key={gender} className="stock-col">
                    <div className="stock-col-head"><b>{gender}</b><span className="muted small">{gUnits} bottles · {rm(gValue)}</span></div>
                    <table className="compact">
                      <thead><tr><th>Scent</th><th className="num">On hand</th><th className="num">Sold</th><th /></tr></thead>
                      <tbody>
                        {items.map((p) => (
                          <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }} title={p.notes}>
                            <td>{p.name.replace(/ \((10|30)ml\)$/, '')}</td>
                            <td className="num">{p.low && <span className="low-tag">low</span>}<b>{p.on_hand}</b></td>
                            <td className="num muted">{p.total_sold}</td>
                            <td className="right nowrap"><button className="link" onClick={() => setModal({ type: 'count', product: p })}>Set count</button><button className="link" onClick={() => setModal({ type: 'product', product: p })}>Edit</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
            <LatestUpdate list={list} size={size} />
          </>
        )}

        {tab === 'batches' && (
          !batchRows.length ? <Empty>No stock added yet. Click "+ Add stock" to record your first batch.</Empty> : (
            <div className="table-wrap">
              <div className="filters">
                <select value={prodMonth} onChange={(e) => setProdMonth(e.target.value)} aria-label="Month">
                  <option value="">All months</option>
                  {batchMonths.map(([m]) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </div>
              <table>
                <thead><tr><th>Date</th><th>Batch</th><th className="num">Bottles</th><th className="num">Cost / bottle</th><th className="num">Total</th><th /></tr></thead>
                {shownMonths.map(([month, groups]) => (
                  <tbody key={month} className="stock-group">
                    <tr className="group-head">
                      <td colSpan={6}>
                        <b>{monthLabel(month)}</b>{' '}
                        <span className="muted small">
                          · {['30ml', '10ml'].map((z) => [z, groups.filter((g) => g.size === z).reduce((a, g) => a + g.qty, 0)]).filter(([, n]) => n).map(([z, n]) => `${n} × ${z}`).join(' · ')}
                          {' '}· {rm(groups.reduce((a, g) => a + g.qty * g.cost, 0))}
                        </span>
                      </td>
                    </tr>
                    {groups.map((g) => [
                      <tr key={g.key}>
                        <td className="nowrap">{fmtDate(g.date)}</td>
                        <td>
                          <span className={'badge size-' + g.size}>{g.size}</span>{' '}
                          <b>{g.title}</b>
                          {g.cash || g.sheet ? null : <span className="badge" style={{ marginLeft: 6 }}>already owned</span>}
                          <div className="row-note">{g.detail}</div>
                        </td>
                        <td className="num">{g.qty}</td>
                        <td className="num">RM {Number(g.cost).toFixed(2)}</td>
                        <td className="num">{rm(g.qty * g.cost)}</td>
                        <td className="right">{g.ids.length === 1 && !g.sheet && <button className="link danger" onClick={async () => (await confirmDelete('Delete this batch? Stock and cash flow will change.', () => api(`/batches/${g.ids[0]}`, { method: 'DELETE' }))) && reloadAll()}>Delete</button>}</td>
                      </tr>,
                      ...g.scents.map((sc) => (
                        <tr key={g.key + sc.name} className="scent-line">
                          <td />
                          <td>{sc.name}</td>
                          <td className="num">{sc.qty}</td>
                          <td className="num">RM {Number(sc.cost).toFixed(2)}</td>
                          <td className="num">{rm(sc.qty * sc.cost)}</td>
                          <td />
                        </tr>
                      )),
                    ])}
                  </tbody>
                ))}
                <tfoot><tr>
                  <td>Total</td>
                  <td className="muted small">{prodMonth ? monthLabel(prodMonth) + ' · ' : ''}{['30ml', '10ml'].map((z) => `${shownGroups.filter((g) => g.size === z).reduce((a, g) => a + g.qty, 0)} × ${z}`).join(' · ')}</td>
                  <td className="num">{shownGroups.reduce((a, g) => a + g.qty, 0)}</td><td />
                  <td className="num">{rm(shownGroups.reduce((a, g) => a + g.qty * g.cost, 0))}</td><td />
                </tr></tfoot>
              </table>
              <p className="muted small" style={{ marginTop: 10 }}>Sheet batches are dated on the event or restock date. Total = bottles × cost per bottle; what you actually paid is in Cash flow under "Stock purchase".</p>
            </div>
          )
        )}

        {tab === 'adj' && (
          !adjRows.length ? <Empty>No write-offs. Testers, damaged or gifted bottles go here.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Product</th><th className="num">Bottles</th><th>Reason</th><th /></tr></thead>
                <tbody>
                  {adjRows.map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{fmtDate(a.date)}</td><td>{a.product_name}</td><td className="num">{a.qty}</td><td>{a.reason}{a.note ? ` · ${a.note}` : ''}</td>
                      <td className="right"><button className="link danger" onClick={async () => (await confirmDelete('Delete this write-off?', () => api(`/adjustments/${a.id}`, { method: 'DELETE' }))) && reloadAll()}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {modal?.type === 'count' && <CountModal product={modal.product} onClose={close} />}
      {modal?.type === 'product' && <ProductModal product={modal.product} onClose={close} />}
      {modal?.type === 'batch' && <BatchModal products={active} onClose={close} />}
      {modal?.type === 'adj' && <AdjModal products={active} onClose={close} />}
    </>
  );
}
