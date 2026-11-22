// Costing sheets: the Excel costing sheet, worked out from the portal's own data, for any period
// (direct selling, a restock month, or an event).
//
//  1. Leftover stock at the start  — stock on hand the day the sheet starts (moving-average cost)
//  2. New restock in the period    — restocks entered on the sheet (parts → cost per bottle) and other batches
//  3. Combined stock & blended cost
//  4. Fixed costs                  — the sheet's own costs (cash entries), or the event's costs
//  5. Sold in the period           — direct sales (no event) for a normal sheet; the event's sales for an event sheet
//  6. Result                       — total cost, sales, net profit, margin, break-even
//  7. Price scenario
//  +  Stock ledger per scent       — opening → in → sold → out → closing

const { db } = require('./db');
const { compute, r2 } = require('./calc');

const SIZES = ['30ml', '10ml'];
const today = () => new Date().toLocaleDateString('en-CA');
const isCount = (note) => /^(Stock count|Leftover count)/.test(note || '');
// Catalog scents only (same as the Stock page). Old placeholder products like "30ml (scent not recorded)"
// hold early sales without a scent; they are left out of stock counts.
const isCatalog = (p) => !!p.active && (p.gender === 'Men' || p.gender === 'Women');

// Stock on hand per product using every movement dated before `cutoff` (moving-average cost, same as calc.js).
function stockBefore(cutoff, products) {
  const st = new Map(products.map((p) => [p.id, { qty: 0, avg: 0 }]));
  const tl = [];
  for (const r of db.prepare('SELECT * FROM batches WHERE date < ?').all(cutoff)) tl.push({ d: r.date, o: 0, id: r.id, k: 'b', r });
  for (const r of db.prepare('SELECT * FROM adjustments WHERE date < ?').all(cutoff)) tl.push({ d: r.date, o: 1, id: r.id, k: 'a', r });
  for (const r of db.prepare('SELECT * FROM sales WHERE date < ?').all(cutoff)) tl.push({ d: r.date, o: 2, id: r.id, k: 's', r });
  tl.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.o - y.o || x.id - y.id));
  for (const t of tl) {
    const s = st.get(t.r.product_id);
    if (!s) continue;
    if (t.k === 'b') {
      const base = Math.max(s.qty, 0), total = base + t.r.qty;
      s.avg = total > 0 ? (base * s.avg + t.r.qty * t.r.unit_cost) / total : t.r.unit_cost;
      s.qty += t.r.qty;
    } else s.qty -= t.r.qty;
  }
  return st;
}
const dayAfter = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

function nextCode() {
  const max = db.prepare("SELECT MAX(CAST(code AS INTEGER)) m FROM costing_sheets").get().m;
  return String(Math.max(Number(max) || 6, 6) + 1).padStart(4, '0'); // Excel sheets went up to 0006
}

function sheetReport(id, depth = 0) {
  const sheet = db.prepare('SELECT * FROM costing_sheets WHERE id = ?').get(id);
  if (!sheet) return null;
  const c = compute();
  const start = sheet.start_date;
  // A running sheet goes up to today — or further, to include its own restocks dated ahead.
  const ownLast = db.prepare('SELECT MAX(date) d FROM restock_groups WHERE sheet_id = ?').get(sheet.id).d;
  const end = sheet.end_date || (ownLast && ownLast > today() ? ownLast : today());
  const inRange = (d) => d >= start && d <= end;
  const products = c.products;
  const lineOf = (pid) => c.productById.get(pid)?.line;
  const event = sheet.event_id ? c.events.find((e) => e.id === sheet.event_id) : null;

  const opening = stockBefore(start, products);
  const closing = stockBefore(dayAfter(end), products);

  const batches = db.prepare('SELECT * FROM batches WHERE date >= ? AND date <= ? ORDER BY date, id').all(start, end);
  const adjs = db.prepare('SELECT * FROM adjustments WHERE date >= ? AND date <= ? ORDER BY date, id').all(start, end);
  const salesAll = c.sales.filter((s) => inRange(s.date));
  // Section 5 scope: an event sheet counts that event's sales; a normal sheet counts sales outside events.
  const salesScope = event ? c.sales.filter((s) => s.event_id === event.id) : salesAll.filter((s) => !s.event_id);

  const groups = db.prepare('SELECT * FROM restock_groups WHERE date >= ? AND date <= ? OR sheet_id = ? ORDER BY date, id').all(start, end, sheet.id)
    .map((g) => ({ ...g, parts: JSON.parse(g.parts || '[]'), items: batches.filter((b) => b.group_id === g.id).map((b) => ({ product_id: b.product_id, name: c.productById.get(b.product_id)?.name, qty: b.qty })) }));

  const lines = SIZES.map((size) => {
    const ids = products.filter((p) => p.line === size && isCatalog(p)).map((p) => p.id);
    // Leftover = stock on hand at the start + bottles counted during the period (stock counts of bottles
    // already owned — that's how leftover was entered before an event, like "Leftover stock" on the sheet).
    const counted = batches.filter((b) => ids.includes(b.product_id) && isCount(b.note));
    const leftQty = ids.reduce((a, i) => a + Math.max(opening.get(i).qty, 0), 0) + counted.reduce((a, b) => a + b.qty, 0);
    const leftVal = ids.reduce((a, i) => a + Math.max(opening.get(i).qty, 0) * opening.get(i).avg, 0) + counted.reduce((a, b) => a + b.qty * b.unit_cost, 0);
    const restock = batches.filter((b) => lineOf(b.product_id) === size && !isCount(b.note));
    const rQty = restock.reduce((a, b) => a + b.qty, 0);
    const rVal = restock.reduce((a, b) => a + b.qty * b.unit_cost, 0);
    const sold = salesScope.filter((s) => lineOf(s.product_id) === size);
    const soldQty = sold.reduce((a, s) => a + s.qty, 0);
    const revenue = sold.reduce((a, s) => a + s.revenue, 0);
    const cogs = sold.reduce((a, s) => a + s.cogs_exact, 0);
    const avail = leftQty + rQty;
    return {
      size,
      leftover: { qty: leftQty, cost: leftQty ? r2(leftVal / leftQty) : 0, value: r2(leftVal) },
      restock: { qty: rQty, cost: rQty ? r2(rVal / rQty) : 0, value: r2(rVal) },
      combined: { qty: avail, cost: avail ? r2((leftVal + rVal) / avail) : 0 },
      sold: { qty: soldQty, revenue: r2(revenue), cogs: r2(cogs), price: soldQty ? r2(revenue / soldQty) : 0 },
      remaining: ids.reduce((a, i) => a + Math.max(closing.get(i).qty, 0), 0),
    };
  });

  // Imported Excel sheets (0001–0006): show the sheet's own leftover / restock / blended figures in
  // sections 1–3 (the portal did not track bottles per scent before 29 Oct), and compare its result.
  let excel = null;
  try { excel = sheet.excel ? JSON.parse(sheet.excel) : null; } catch { excel = null; }
  if (excel?.lines) {
    for (const l of lines) {
      const x = excel.lines[l.size];
      if (!x) continue;
      const lq = x.leftover?.[0] || 0, lc = x.leftover?.[1] || 0, rq = x.restock?.[0] || 0, rc = x.restock?.[1] || 0;
      l.leftover = { qty: lq, cost: r2(lc), value: r2(lq * lc) };
      l.restock = { qty: rq, cost: r2(rc), value: r2(rq * rc) };
      l.combined = { qty: lq + rq, cost: lq + rq ? r2((lq * lc + rq * rc) / (lq + rq)) : 0 };
      l.from_sheet = true;
    }
  }

  // Like the Excel sheets: a new sheet's leftover bottles carry the previous sheet's blended cost
  // ("Leftover cost/bottle — from last batch"), so the chain 0006 → 0007 → 0008 matches the sheets.
  if (!excel?.lines) {
    const prev = db.prepare('SELECT id FROM costing_sheets WHERE id != ? AND (start_date < ? OR (start_date = ? AND code < ?)) ORDER BY start_date DESC, code DESC LIMIT 1')
      .get(sheet.id, start, start, sheet.code);
    const prevLines = prev && depth < 3 ? sheetReport(prev.id, depth + 1)?.lines : null;
    for (const l of lines) {
      const pc = prevLines?.find((x) => x.size === l.size)?.combined.cost;
      if (!(pc > 0) || !l.leftover.qty) continue;
      l.leftover.cost = r2(pc);
      l.leftover.value = r2(l.leftover.qty * pc);
      const rv = l.restock.qty * l.restock.cost;
      l.combined.cost = l.combined.qty ? r2((l.leftover.qty * pc + rv) / l.combined.qty) : 0;
      l.leftover_from_prev = true;
    }
  }

  // 4. Fixed costs
  const sheetCosts = db.prepare('SELECT id, date, description, amount, category FROM transactions WHERE sheet_id = ? ORDER BY date, id').all(sheet.id);
  const eventCosts = event ? event.costs.map((x) => ({ id: 'e' + x.id, date: x.date, description: x.description || x.category, amount: x.amount, from_event: true })) : [];
  const fixedRows = [...eventCosts, ...sheetCosts];
  const fixed = fixedRows.reduce((a, x) => a + x.amount, 0) + (event ? event.wages + event.commission : 0);

  // 6. Result
  const bottles = lines.reduce((a, l) => a + l.sold.qty, 0);
  const sales = lines.reduce((a, l) => a + l.sold.revenue, 0);
  const variable = lines.reduce((a, l) => a + l.sold.cogs, 0);
  const total = fixed + variable;
  const profit = sales - total;
  const grossPer = bottles ? (sales - variable) / bottles : 0;
  const result = {
    fixed: r2(fixed), variable: r2(variable), total: r2(total), sales: r2(sales), profit: r2(profit),
    margin_pct: sales ? r2((profit / sales) * 100) : 0,
    gross_per_bottle: r2(grossPer), gross_margin_pct: sales ? r2(((sales - variable) / sales) * 100) : 0,
    break_even_price: bottles ? r2(total / bottles) : 0,
    break_even_bottles: grossPer > 0 ? Math.ceil(fixed / grossPer) : 0,
    bottles,
  };

  // 7. Price scenario (same steps as the sheet: −10 … +15 on both sizes, at the bottles sold)
  const scenario = [-10, -5, 0, 5, 10, 15].map((step) => {
    const prices = lines.map((l) => (l.sold.qty ? Math.max(l.sold.price + step, 0) : 0));
    const s = lines.reduce((a, l, i) => a + prices[i] * l.sold.qty, 0);
    return { step, prices: { '30ml': r2(prices[0]), '10ml': r2(prices[1]) }, sales: r2(s), profit: r2(s - total), margin_pct: s ? r2(((s - total) / s) * 100) : 0 };
  });

  // Stock ledger per scent
  const ledger = SIZES.map((size) => ({
    size,
    rows: products.filter((p) => p.line === size && (isCatalog(p) || batches.some((b) => b.product_id === p.id) || salesAll.some((x) => x.product_id === p.id) || adjs.some((a) => a.product_id === p.id))).map((p) => {
      const inRestock = batches.filter((b) => b.product_id === p.id && !isCount(b.note)).reduce((a, b) => a + b.qty, 0);
      const inCount = batches.filter((b) => b.product_id === p.id && isCount(b.note)).reduce((a, b) => a + b.qty, 0);
      const sold = salesAll.filter((s) => s.product_id === p.id).reduce((a, s) => a + s.qty, 0);
      const out = adjs.filter((a) => a.product_id === p.id).reduce((x, a) => x + a.qty, 0);
      return { product_id: p.id, name: p.name.replace(/ \((10|30)ml\)$/, ''), catalog: isCatalog(p), opening: opening.get(p.id).qty, in: inRestock + inCount, sold, out, closing: closing.get(p.id).qty };
    }),
  }));

  // Check against the Excel sheet's own result (rows 6): ✓ when equal to the sen.
  const check = excel?.result ? [
    ['Total fixed cost', excel.result.fixed, result.fixed],
    ['Total variable cost', excel.result.variable, result.variable],
    ['Total cost', excel.result.total, result.total],
    ['Total sale', excel.result.sales, result.sales],
    ['Net profit', excel.result.profit, result.profit],
  ].map(([label, x, p]) => ({ label, excel: r2(x), portal: r2(p), ok: Math.abs(r2(x) - r2(p)) < 0.01 })) : null;

  return {
    sheet: { ...sheet, end_effective: end, event_name: event?.name || null, excel: undefined },
    check, check_notes: excel?.notes || [],
    lines, groups, fixed: fixedRows, result, scenario, ledger,
    sales_note: event ? `Sales of ${event.name}` : 'Sales outside events (direct selling, agents, online)',
  };
}

// ---------------------------------------------------------------- routes (owner only; staff are blocked in app.js)
function mount(app, h) {
  const { wrap, bad, pick, need, insert, update, remove, isDate } = h;
  const notFound = () => Object.assign(new Error('Not found'), { status: 404 });

  app.get('/api/costing', wrap((_req, res) => {
    const rows = db.prepare('SELECT * FROM costing_sheets ORDER BY start_date DESC, id DESC').all();
    res.json({ next_code: nextCode(), rows: rows.map((s) => { const r = sheetReport(s.id); return { ...r.sheet, result: r.result, restocks: r.groups.length }; }) });
  }));
  app.get('/api/costing/:id', wrap((req, res) => { const r = sheetReport(Number(req.params.id)); if (!r) throw notFound(); res.json(r); }));

  const SHEET = { code: 'text', title: 'text', start_date: 'date', end_date: 'text', event_id: 'id', note: 'text', excel: 'text' };
  const clean = (d) => {
    if (d.end_date !== undefined) { if (d.end_date && !isDate(d.end_date)) throw bad('end_date must be a date'); d.end_date = d.end_date || null; }
    if (d.start_date && d.end_date && d.end_date < d.start_date) throw bad('End date is before start date');
    if (d.excel) { try { JSON.parse(d.excel); } catch { throw bad('excel must be JSON'); } }
    return d;
  };
  app.post('/api/costing', wrap((req, res) => {
    const d = clean(pick(req.body, SHEET)); need(d, ['title', 'start_date']);
    if (!d.code) d.code = nextCode();
    res.json(insert('costing_sheets', d));
  }));
  app.put('/api/costing/:id', wrap((req, res) => res.json(update('costing_sheets', req.params.id, clean(pick(req.body, SHEET))))));
  app.delete('/api/costing/:id', wrap((req, res) => {
    if (db.prepare('SELECT 1 FROM restock_groups WHERE sheet_id = ?').get(req.params.id)) throw bad('This sheet has restocks. Delete them first.');
    if (db.prepare('SELECT 1 FROM transactions WHERE sheet_id = ?').get(req.params.id)) throw bad('This sheet has costs. Delete them first.');
    remove('costing_sheets', req.params.id); res.json({ ok: true });
  }));

  // 4. A fixed cost on the sheet = a cash-out entry (shows in Cash flow and Monthly report).
  app.post('/api/costing/:id/costs', wrap((req, res) => {
    const sheet = db.prepare('SELECT * FROM costing_sheets WHERE id = ?').get(req.params.id);
    if (!sheet) throw notFound();
    const d = pick(req.body, { date: 'date', description: 'text', amount: 'num' }); need(d, ['date', 'description', 'amount']);
    if (d.amount <= 0) throw bad('Amount must be more than 0');
    res.json(insert('transactions', { ...d, type: 'out', category: 'Selling cost', sheet_id: sheet.id, description: `${sheet.code}: ${d.description}` }));
  }));
  app.delete('/api/costing/costs/:cid', wrap((req, res) => {
    const t = db.prepare('SELECT * FROM transactions WHERE id = ? AND sheet_id IS NOT NULL').get(req.params.cid);
    if (!t) throw notFound();
    remove('transactions', t.id); res.json({ ok: true });
  }));

  // 2. Restock: parts → cost per bottle, then bottles per scent. Creates normal stock batches.
  app.post('/api/costing/:id/restock', wrap((req, res) => {
    const sheet = db.prepare('SELECT * FROM costing_sheets WHERE id = ?').get(req.params.id);
    if (!sheet) throw notFound();
    const b = req.body || {};
    if (!isDate(b.date)) throw bad('date must be a date (YYYY-MM-DD)');
    if (!SIZES.includes(b.size)) throw bad('size must be 30ml or 10ml');
    const parts = (Array.isArray(b.parts) ? b.parts : []).map((p) => ({ name: String(p.name || '').trim(), cost: Number(p.cost) || 0, qty: Math.round(Number(p.qty) || 0) }))
      .filter((p) => p.name && p.cost > 0 && p.qty > 0);
    if (!parts.length) throw bad('Enter at least one part with a batch cost and quantity');
    const unit = Math.round(parts.reduce((a, p) => a + p.cost / p.qty, 0) * 10000) / 10000;
    const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({ product_id: Number(i.product_id), qty: Math.round(Number(i.qty) || 0) })).filter((i) => i.qty > 0);
    if (!items.length) throw bad('Enter how many bottles of each scent');
    for (const i of items) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(i.product_id);
      if (!p || p.line !== b.size) throw bad('Each scent must be a ' + b.size + ' product');
    }
    const cash = b.cash_paid === false || b.cash_paid === 0 ? 0 : 1;
    const note = `${sheet.code} sheet restock: ` + parts.map((p) => `${p.name} RM${p.cost}/${p.qty}`).join(', ');
    const g = db.transaction(() => {
      const grp = insert('restock_groups', { sheet_id: sheet.id, date: b.date, size: b.size, parts: JSON.stringify(parts), unit_cost: unit, supplier: String(b.supplier || '').trim(), cash_paid: cash });
      for (const i of items) insert('batches', { product_id: i.product_id, date: b.date, qty: i.qty, unit_cost: unit, supplier: grp.supplier, note, cash_paid: cash, group_id: grp.id });
      return grp;
    })();
    res.json({ ...g, bottles: items.reduce((a, i) => a + i.qty, 0) });
  }));
  app.delete('/api/costing/restock/:gid', wrap((req, res) => {
    const g = db.prepare('SELECT * FROM restock_groups WHERE id = ?').get(req.params.gid);
    if (!g) throw notFound();
    db.transaction(() => { db.prepare('DELETE FROM batches WHERE group_id = ?').run(g.id); remove('restock_groups', g.id); })();
    res.json({ ok: true });
  }));
}

module.exports = { mount, sheetReport };
