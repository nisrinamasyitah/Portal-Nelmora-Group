const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// The portal's API. Started on your computer by server/index.js, and on Netlify by netlify/functions/api.js.
// Settings (PORTAL_PASSWORD, ...) must already be in process.env when this file is loaded.
const express = require('express');
const { db, getSettings, restoreDatabase } = require('./db');
const { compute, agentRate, r2 } = require('./calc');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------- auth (optional)
// Set PORTAL_PASSWORD in .env to require a login. Leave empty for local-only use.
// PORTAL_EMAIL is optional: when set, the email must match too (case-insensitive).
const PASSWORD = process.env.PORTAL_PASSWORD || '';
const EMAIL = (process.env.PORTAL_EMAIL || '').trim().toLowerCase();
const SECRET = crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'nelmora:' + PASSWORD).digest();
const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function makeToken() {
  const exp = String(Date.now() + 1000 * 60 * 60 * 24 * 14); // 14 days
  return `${exp}.${sign(exp)}`;
}
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  return !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}
const failures = new Map(); // tiny brute-force guard
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const f = failures.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  const emailOk = !EMAIL || safeEq(String(req.body.email || '').trim().toLowerCase(), EMAIL);
  const passOk = safeEq(req.body.password || '', PASSWORD);
  if (!PASSWORD || (emailOk && passOk)) {
    failures.delete(ip);
    return res.json({ token: makeToken() });
  }
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + 60_000; f.n = 0; }
  failures.set(ip, f);
  res.status(401).json({ error: EMAIL ? 'Incorrect email or password' : 'Wrong password' });
});
app.get('/api/auth-required', (_req, res) => res.json({ required: !!PASSWORD, email: !!EMAIL }));
app.use('/api', (req, res, next) => {
  if (!PASSWORD) return next();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (validToken(token)) return next();
  res.status(401).json({ error: 'Login required' });
});

// ---------------------------------------------------------------- helpers
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

function pick(body, spec) {
  // spec: { field: 'text' | 'num' | 'int' | 'date' | 'bool' | 'id' }
  const out = {};
  for (const [k, type] of Object.entries(spec)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (type === 'text') out[k] = v == null ? '' : String(v).trim();
    else if (type === 'num') { const n = Number(v); if (!Number.isFinite(n)) throw bad(`${k} must be a number`); out[k] = n; }
    else if (type === 'int') { const n = Math.round(Number(v)); if (!Number.isFinite(n)) throw bad(`${k} must be a whole number`); out[k] = n; }
    else if (type === 'date') { if (!isDate(v)) throw bad(`${k} must be a date (YYYY-MM-DD)`); out[k] = v; }
    else if (type === 'bool') out[k] = v ? 1 : 0;
    else if (type === 'id') out[k] = v === '' || v == null ? null : Number(v);
  }
  return out;
}

function insert(table, data) {
  const keys = Object.keys(data);
  const info = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(data));
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}
function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) throw bad('Nothing to update');
  const info = db.prepare(`UPDATE ${table} SET ${keys.map((k) => k + ' = ?').join(',')} WHERE id = ?`).run(...Object.values(data), id);
  if (!info.changes) throw Object.assign(new Error('Not found'), { status: 404 });
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}
function remove(table, id) {
  const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (!info.changes) throw Object.assign(new Error('Not found'), { status: 404 });
}
function need(data, fields) {
  for (const f of fields) if (data[f] === undefined || data[f] === null || data[f] === '') throw bad(`${f} is required`);
}

// ---------------------------------------------------------------- settings
app.get('/api/settings', wrap((_req, res) => res.json(getSettings())));
app.put('/api/settings', wrap((req, res) => {
  const b = req.body || {};
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const allowed = {
    business_name: (v) => String(v).trim() || 'Nelmora',
    opening_cash: (v) => Number(v) || 0,
    opening_cash_date: (v) => { if (v && !isDate(v)) throw bad('opening_cash_date must be a date'); return v || ''; },
    default_daily_wage: (v) => Number(v) || 0,
    default_commission: (v) => Number(v) || 0,
    agent_tiers: (v) => {
      if (!Array.isArray(v)) throw bad('agent_tiers must be a list');
      return v.map((t) => ({ min: Math.round(Number(t.min)), rate: Number(t.rate) })).filter((t) => t.min > 0 && t.rate >= 0);
    },
  };
  for (const [k, fn] of Object.entries(allowed)) if (k in b) put.run(k, JSON.stringify(fn(b[k])));
  res.json(getSettings());
}));

// ---------------------------------------------------------------- products & stock
const PRODUCT = { name: 'text', line: 'text', gender: 'text', price: 'num', reorder_level: 'int', active: 'bool', notes: 'text' };
app.get('/api/stock', wrap((_req, res) => res.json(compute().stock)));app.post('/api/products', wrap((req, res) => {
  const d = pick(req.body, PRODUCT); need(d, ['name']);
  res.json(insert('products', d));
}));
app.put('/api/products/:id', wrap((req, res) => res.json(update('products', req.params.id, pick(req.body, PRODUCT)))));
app.delete('/api/products/:id', wrap((req, res) => {
  const id = req.params.id;
  const used = ['batches', 'sales', 'adjustments'].some((t) => db.prepare(`SELECT 1 FROM ${t} WHERE product_id = ?`).get(id));
  if (used) throw Object.assign(new Error('This product has stock or sales history. Mark it inactive instead of deleting.'), { status: 409 });
  remove('products', id); res.json({ ok: true });
}));

const BATCH = { product_id: 'id', date: 'date', qty: 'int', unit_cost: 'num', supplier: 'text', note: 'text', cash_paid: 'bool' };
app.get('/api/batches', wrap((_req, res) => {
  const rows = db.prepare(`SELECT b.*, p.name AS product_name FROM batches b JOIN products p ON p.id = b.product_id ORDER BY b.date DESC, b.id DESC`).all();
  res.json(rows.map((b) => ({ ...b, total_cost: r2(b.qty * b.unit_cost) })));
}));
app.post('/api/batches', wrap((req, res) => {
  const d = pick(req.body, BATCH); need(d, ['product_id', 'date', 'qty', 'unit_cost']);
  if (d.qty <= 0) throw bad('qty must be more than 0');
  res.json(insert('batches', d));
}));
app.put('/api/batches/:id', wrap((req, res) => res.json(update('batches', req.params.id, pick(req.body, BATCH)))));
app.delete('/api/batches/:id', wrap((req, res) => { remove('batches', req.params.id); res.json({ ok: true }); }));

const ADJ = { product_id: 'id', date: 'date', qty: 'int', reason: 'text', note: 'text' };
app.get('/api/adjustments', wrap((_req, res) => {
  res.json(db.prepare(`SELECT a.*, p.name AS product_name FROM adjustments a JOIN products p ON p.id = a.product_id ORDER BY a.date DESC, a.id DESC`).all());
}));
app.post('/api/adjustments', wrap((req, res) => {
  const d = pick(req.body, ADJ); need(d, ['product_id', 'date', 'qty']);
  if (d.qty <= 0) throw bad('qty must be more than 0');
  res.json(insert('adjustments', d));
}));
// Set the counted number of bottles for one scent. Fewer → a "Stock count" adjustment (not a loss);
// more → a no-cash batch at the current average cost. Profit and cash flow are not affected.
app.post('/api/stock-count', wrap((req, res) => {
  const d = pick(req.body, { product_id: 'id', date: 'date', count: 'int' }); need(d, ['product_id', 'date', 'count']);
  if (d.count < 0) throw bad('Count cannot be negative');
  const p = compute().stock.find((s) => s.id === d.product_id);
  if (!p) throw Object.assign(new Error('Product not found'), { status: 404 });
  const diff = d.count - p.on_hand;
  if (diff < 0) insert('adjustments', { product_id: p.id, date: d.date, qty: -diff, reason: 'Stock count', note: `Counted ${d.count} (was ${p.on_hand})` });
  if (diff > 0) insert('batches', { product_id: p.id, date: d.date, qty: diff, unit_cost: p.avg_cost || 0, supplier: '', note: `Stock count: counted ${d.count} (was ${p.on_hand})`, cash_paid: 0 });
  res.json({ ok: true, before: p.on_hand, after: d.count, change: diff });
}));
app.delete('/api/adjustments/:id', wrap((req, res) => { remove('adjustments', req.params.id); res.json({ ok: true }); }));

// ---------------------------------------------------------------- events
const EVENT = { name: 'text', location: 'text', start_date: 'date', end_date: 'date', worker_days: 'num', daily_wage: 'num', commission_rate: 'num', note: 'text',
  plan_qty_30: 'int', plan_price_30: 'num', plan_qty_10: 'int', plan_price_10: 'num', plan_cost_30: 'num', plan_cost_10: 'num' };
app.get('/api/events', wrap((_req, res) => res.json(compute().events.map(({ costs, ...e }) => e))));
app.get('/api/events/:id', wrap((req, res) => {
  const c = compute();
  const ev = c.events.find((e) => e.id === Number(req.params.id));
  if (!ev) throw Object.assign(new Error('Event not found'), { status: 404 });
  res.json({ ...ev, sales: c.sales.filter((s) => s.event_id === ev.id) });
}));
app.post('/api/events', wrap((req, res) => {
  const s = getSettings();
  const body = { daily_wage: s.default_daily_wage, commission_rate: s.default_commission, ...req.body };
  const d = pick(body, EVENT); need(d, ['name', 'start_date', 'end_date']);
  if (d.end_date < d.start_date) throw bad('End date is before start date');
  res.json(insert('events', d));
}));
app.put('/api/events/:id', wrap((req, res) => {
  const d = pick(req.body, EVENT);
  if (d.start_date && d.end_date && d.end_date < d.start_date) throw bad('End date is before start date');
  res.json(update('events', req.params.id, d));
}));
app.delete('/api/events/:id', wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM sales WHERE event_id = ?').get(req.params.id)) {
    throw Object.assign(new Error('This event has sales recorded. Delete those sales first.'), { status: 409 });
  }
  remove('events', req.params.id); res.json({ ok: true });
}));

const COST = { date: 'date', category: 'text', description: 'text', amount: 'num' };
app.post('/api/events/:id/costs', wrap((req, res) => {
  const d = pick(req.body, COST); need(d, ['amount']);
  if (d.date === undefined || d.date === '') delete d.date;
  res.json(insert('event_costs', { ...d, event_id: Number(req.params.id) }));
}));
app.put('/api/costs/:id', wrap((req, res) => res.json(update('event_costs', req.params.id, pick(req.body, COST)))));
app.delete('/api/costs/:id', wrap((req, res) => { remove('event_costs', req.params.id); res.json({ ok: true }); }));

// ---------------------------------------------------------------- sales
const SALE = { date: 'date', product_id: 'id', qty: 'int', unit_price: 'num', channel: 'text', event_id: 'id', agent_id: 'id', note: 'text', scent: 'text' };
const CHANNELS = ['booth', 'agent', 'online', 'other'];
function checkSale(d) {
  if (!CHANNELS.includes(d.channel)) throw bad('channel must be booth, agent, online or other');
  if (d.channel === 'booth' && !d.event_id) throw bad('Booth sales need an event');
  if (d.channel === 'agent' && !d.agent_id) throw bad('Agent sales need an agent');
  if (d.channel !== 'booth') d.event_id = d.channel === 'booth' ? d.event_id : d.event_id || null;
  if (d.channel !== 'agent') d.agent_id = null;
  if (d.qty <= 0) throw bad('qty must be more than 0');
}
// Profit per bottle for direct selling: catalog price − cost from the latest costing sheet
app.get('/api/direct-profit', wrap((_req, res) => {
  const c = compute();
  const out = ['30ml', '10ml'].map((line) => {
    const prices = c.products.filter((p) => p.active && p.line === line).map((p) => p.price);
    const price = prices.length ? prices.sort((a, b) => prices.filter((x) => x === b).length - prices.filter((x) => x === a).length)[0] : 0;
    const cost = c.sheetCost[line]?.cost || 0;
    return { line, price, cost: r2(cost), from: c.sheetCost[line]?.from || null, profit: r2(price - cost), margin_pct: price ? r2(((price - cost) / price) * 100) : 0 };
  });
  res.json(out);
}));
app.get('/api/sales', wrap((req, res) => {
  let rows = compute().sales;
  const { month, channel, event_id, agent_id } = req.query;
  if (month) rows = rows.filter((s) => s.date.startsWith(month));
  if (channel) rows = rows.filter((s) => s.channel === channel);
  if (event_id) rows = rows.filter((s) => s.event_id === Number(event_id));
  if (agent_id) rows = rows.filter((s) => s.agent_id === Number(agent_id));
  res.json(rows);
}));
app.post('/api/sales', wrap((req, res) => {
  const d = pick({ channel: 'booth', ...req.body }, SALE); need(d, ['date', 'product_id', 'qty', 'unit_price']);
  checkSale(d); res.json(insert('sales', d));
}));
// Record several products at once (end-of-day count): { date, channel, event_id, agent_id, items: [{product_id, qty, unit_price}] }
app.post('/api/sales/bulk', wrap((req, res) => {
  const { items = [], ...head } = req.body || {};
  const rows = items.filter((i) => Number(i.qty) > 0);
  if (!rows.length) throw bad('Enter a quantity for at least one product');
  const made = db.transaction(() => rows.map((i) => {
    const d = pick({ channel: 'booth', ...head, ...i }, SALE); need(d, ['date', 'product_id', 'qty', 'unit_price']);
    checkSale(d); return insert('sales', d);
  }))();
  res.json({ created: made.length });
}));
app.put('/api/sales/:id', wrap((req, res) => {
  const cur = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!cur) throw Object.assign(new Error('Not found'), { status: 404 });
  const d = pick({ ...cur, ...req.body }, SALE); checkSale(d);
  res.json(update('sales', req.params.id, d));
}));
app.delete('/api/sales/:id', wrap((req, res) => { remove('sales', req.params.id); res.json({ ok: true }); }));

// ---------------------------------------------------------------- agents
const AGENT = { name: 'text', phone: 'text', note: 'text', active: 'bool' };
app.get('/api/agents', wrap((_req, res) => {
  const c = compute();
  res.json(c.agents.map((a) => {
    const rows = c.sales.filter((s) => s.agent_id === a.id);
    return {
      ...a,
      bottles: rows.reduce((x, s) => x + s.qty, 0),
      revenue: r2(rows.reduce((x, s) => x + s.revenue, 0)),
      commission: r2(rows.reduce((x, s) => x + s.commission, 0)),
      last_sale: rows.length ? rows[0].date : null,
    };
  }));
}));
app.post('/api/agents', wrap((req, res) => { const d = pick(req.body, AGENT); need(d, ['name']); res.json(insert('agents', d)); }));
app.put('/api/agents/:id', wrap((req, res) => res.json(update('agents', req.params.id, pick(req.body, AGENT)))));
app.delete('/api/agents/:id', wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM sales WHERE agent_id = ?').get(req.params.id)) {
    throw Object.assign(new Error('This agent has sales. Mark them inactive instead.'), { status: 409 });
  }
  remove('agents', req.params.id); res.json({ ok: true });
}));

// ---------------------------------------------------------------- cash flow
const TX = { date: 'date', type: 'text', category: 'text', description: 'text', amount: 'num' };
app.get('/api/cashflow', wrap((_req, res) => {
  const c = compute();
  res.json({ opening_cash: Number(c.settings.opening_cash) || 0, opening_cash_date: c.settings.opening_cash_date || '', balance: c.cashBalance, entries: [...c.ledger].reverse() });
}));
app.post('/api/transactions', wrap((req, res) => {
  const d = pick(req.body, TX); need(d, ['date', 'type', 'amount']);
  if (!['in', 'out'].includes(d.type)) throw bad('type must be in or out');
  if (d.amount <= 0) throw bad('amount must be more than 0');
  res.json(insert('transactions', d));
}));
app.put('/api/transactions/:id', wrap((req, res) => res.json(update('transactions', req.params.id, pick(req.body, TX)))));
app.delete('/api/transactions/:id', wrap((req, res) => { remove('transactions', req.params.id); res.json({ ok: true }); }));

// ---------------------------------------------------------------- reports & dashboard
app.get('/api/monthly', wrap((_req, res) => res.json(compute().monthly)));

app.get('/api/dashboard', wrap((_req, res) => {
  const c = compute();
  const today = new Date().toLocaleDateString('en-CA');
  const thisMonth = today.slice(0, 7);
  const cur = c.monthly.find((m) => m.month === thisMonth) || { month: thisMonth, revenue: 0, bottles: 0, net_profit: 0, gross_profit: 0, cash_in: 0, cash_out: 0 };
  const totals = c.monthly.reduce((a, m) => ({ revenue: a.revenue + m.revenue, net_profit: a.net_profit + m.net_profit, bottles: a.bottles + m.bottles }), { revenue: 0, net_profit: 0, bottles: 0 });

  const cutoff = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA');
  // Stock = catalog scents only (same as the Stock page). Hidden products hold past sales with no scent recorded.
  const catalog = c.stock.filter((s) => s.active);
  const activeIds = new Set(catalog.map((s) => s.id));
  const recent = c.sales.filter((s) => s.date >= cutoff);
  const sold = new Map();
  recent.filter((s) => activeIds.has(s.product_id)).forEach((s) => sold.set(s.product_name, (sold.get(s.product_name) || 0) + s.qty));
  const topSellers = [...sold.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const lineOf = (id) => c.productById.get(id)?.line;
  const soldBySize = ['30ml', '10ml'].map((line) => ({ line, qty: recent.filter((s) => lineOf(s.product_id) === line).reduce((a, s) => a + s.qty, 0) }));

  res.json({
    today,
    cash_balance: c.cashBalance,
    // Last day with real (not upcoming) cash entries, summed — same as the Cash flow page.
    last_update: (() => {
      const done = c.ledger.filter((l) => !l.upcoming);
      if (!done.length) return null;
      const date = done[done.length - 1].date;
      const day = done.filter((l) => l.date === date);
      return { date, net: r2(day.reduce((a, l) => a + (l.type === 'in' ? l.amount : -l.amount), 0)), categories: [...new Set(day.map((l) => l.category))] };
    })(),
    this_month: cur,
    totals: { revenue: r2(totals.revenue), net_profit: r2(totals.net_profit), bottles: totals.bottles },
    stock_value: r2(catalog.reduce((a, s) => a + s.stock_value, 0)),
    stock_units: catalog.reduce((a, s) => a + Math.max(s.on_hand, 0), 0),
    stock_by_size: ['30ml', '10ml'].map((line) => ({ line, units: catalog.filter((s) => s.line === line).reduce((a, s) => a + Math.max(s.on_hand, 0), 0) })),
    sold_by_size: soldBySize,
    low_stock: catalog.filter((s) => s.low).map((s) => ({ id: s.id, name: s.name, on_hand: s.on_hand, reorder_level: s.reorder_level })),
    top_sellers: topSellers,
    upcoming_events: c.events.filter((e) => e.end_date >= today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1)).slice(0, 4).map(({ costs, ...e }) => e),
    recent_events: c.events.filter((e) => e.end_date < today).slice(0, 4).map(({ costs, ...e }) => e),
    monthly: c.monthly.slice(-12),
  });
}));

// ---------------------------------------------------------------- backup
app.get('/api/backup', wrap((_req, res) => {
  const buf = db.serialize();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="nelmora-backup-${new Date().toLocaleDateString('en-CA')}.db"`);
  res.send(buf);
}));

// Restore: replace ALL data with an uploaded backup file (the .db from "Download backup").
app.post('/api/restore', express.raw({ type: '*/*', limit: '20mb' }), wrap((req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Choose a backup file (.db) to upload.');
  try {
    res.json({ ok: true, ...restoreDatabase(req.body) });
  } catch (e) { throw bad(e.message); }
}));

// ---------------------------------------------------------------- static frontend (after `npm run build`)
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  const status = err.status || (String(err.code || '').startsWith('SQLITE_CONSTRAINT') ? 409 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server' : err.message });
});

app.locals.passwordSet = !!PASSWORD;
module.exports = app;
