// All the business maths lives here, in one place, so it is easy to read and check.
//
//  Stock cost  : moving weighted-average cost (WAC). Leftover stock keeps its cost and blends
//                with new batches. Unsold stock is an asset, never a loss.
//  Event profit: revenue - cost of bottles sold - wages - commission - other event costs.
//  Cash flow   : every real cash movement (sales in, stock purchases / event costs / wages /
//                commissions / manual entries out), with a running balance.

const { db, getSettings, dbVersion } = require('./db');

// Not part of profit: owner money in/out, and stock purchases (stock becomes a cost only when bottles are sold).
const NON_OPERATING = new Set(['Capital injection', 'Owner withdrawal', 'Stock purchase']);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const monthOf = (d) => String(d).slice(0, 7);
const all = (sql) => db.prepare(sql).all();

function agentRate(tiers, totalQty) {
  const sorted = [...(tiers || [])].sort((a, b) => b.min - a.min);
  for (const t of sorted) if (totalQty >= t.min) return Number(t.rate);
  return 0;
}

// Event plan: what the event should make if you sell your target bottles at your target price.
// Mirrors the costing sheet: fixed costs + variable cost (bottles × blended cost) + booth commission.
function planEvent(e, fixed, lineStats) {
  const lines = [
    { size: '30ml', qty: e.plan_qty_30 || 0, price: e.plan_price_30 || 0, own: e.plan_cost_30 || 0 },
    { size: '10ml', qty: e.plan_qty_10 || 0, price: e.plan_price_10 || 0, own: e.plan_cost_10 || 0 },
  ]
    .filter((l) => l.qty > 0)
    .map(({ own, ...l }) => {
      // The event's own cost/bottle (from its costing sheet) wins; otherwise use today's stock cost.
      const { cost: stockCost, available } = lineStats[l.size];
      const cost = own > 0 ? own : stockCost;
      return {
        ...l,
        cost,
        cost_source: own > 0 ? 'event' : 'stock',
        available,
        left_after: available - l.qty,
        gross_per_bottle: r2(l.price - cost),
        gross_margin_pct: l.price > 0 ? r2(((l.price - cost) / l.price) * 100) : 0,
      };
    });
  if (!lines.length) return null;

  const bottles = lines.reduce((a, l) => a + l.qty, 0);
  const sales = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const variable = lines.reduce((a, l) => a + l.qty * l.cost, 0);
  const commission = bottles * e.commission_rate;
  const totalCost = fixed + variable + commission;
  const profit = sales - totalCost;
  const contribution = (sales - variable - commission) / bottles;

  // Price scenarios: move every size's price up/down in RM 5 steps, same target bottles.
  const scenarios = [];
  for (let i = -3; i <= 3; i++) {
    const prices = lines.map((l) => l.price + i * 5);
    if (prices.some((p) => p <= 0)) continue;
    const s = lines.reduce((a, l, j) => a + l.qty * prices[j], 0);
    const p = s - totalCost;
    scenarios.push({ step: i, prices, sales: r2(s), profit: r2(p), margin_pct: r2((p / s) * 100) });
  }

  return {
    lines,
    bottles,
    sales: r2(sales),
    fixed: r2(fixed),
    variable: r2(variable),
    commission: r2(commission),
    total_cost: r2(totalCost),
    profit: r2(profit),
    margin_pct: sales > 0 ? r2((profit / sales) * 100) : 0,
    break_even_price: r2(totalCost / bottles),
    break_even_bottles: contribution > 0 ? Math.ceil(fixed / contribution) : null,
    scenarios,
  };
}

function computeFresh() {
  const settings = getSettings();
  const products = all('SELECT * FROM products ORDER BY line DESC, name');
  const batches = all('SELECT * FROM batches');
  const adjustments = all('SELECT * FROM adjustments');
  const salesRaw = all('SELECT * FROM sales');
  const events = all('SELECT * FROM events ORDER BY start_date DESC, id DESC');
  const costs = all('SELECT * FROM event_costs');
  const agents = all('SELECT * FROM agents ORDER BY name');
  const txs = all('SELECT * FROM transactions');

  const productById = new Map(products.map((p) => [p.id, p]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  // ---------- 1. Stock engine (moving weighted-average cost) ----------
  const state = new Map(products.map((p) => [p.id, { qty: 0, avg: 0 }]));
  const timeline = [];
  batches.forEach((r) => timeline.push({ d: r.date, o: 0, id: r.id, k: 'b', r }));
  adjustments.forEach((r) => timeline.push({ d: r.date, o: 1, id: r.id, k: 'a', r }));
  salesRaw.forEach((r) => timeline.push({ d: r.date, o: 2, id: r.id, k: 's', r }));
  timeline.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.o - y.o || x.id - y.id));

  const saleCost = new Map(); // sale id -> unit cost at time of sale
  const adjCost = new Map();  // adjustment id -> unit cost at time
  for (const t of timeline) {
    const st = state.get(t.r.product_id);
    if (!st) continue;
    // Last day this scent's stock moved: remember the count before that day and what happened.
    if (st.lastDate !== t.d) { st.lastDate = t.d; st.prev = st.qty; st.kinds = new Set(); }
    const kind = t.k === 'b' ? (/^(Stock count|Leftover count)/.test(t.r.note || '') ? 'count' : 'restock')
      : t.k === 'a' ? (t.r.reason === 'Stock count' ? 'count' : 'write-off') : 'sold';
    st.kinds.add(kind);
    if (t.k === 'b') {
      const base = Math.max(st.qty, 0);
      const total = base + t.r.qty;
      st.avg = total > 0 ? (base * st.avg + t.r.qty * t.r.unit_cost) / total : t.r.unit_cost;
      st.qty += t.r.qty;
    } else if (t.k === 'a') {
      adjCost.set(t.r.id, st.avg);
      st.qty -= t.r.qty;
    } else {
      saleCost.set(t.r.id, st.avg);
      st.qty -= t.r.qty;
    }
  }

  const stock = products.map((p) => {
    const st = state.get(p.id);
    const sold = salesRaw.filter((s) => s.product_id === p.id).reduce((a, s) => a + s.qty, 0);
    return {
      ...p,
      on_hand: st.qty,
      avg_cost: r2(st.avg),
      stock_value: r2(Math.max(st.qty, 0) * st.avg),
      margin_pct: p.price > 0 ? r2(((p.price - st.avg) / p.price) * 100) : 0,
      total_sold: sold,
      last_date: st.lastDate || null,
      prev_on_hand: st.lastDate ? st.prev : null,
      last_kinds: st.kinds ? [...st.kinds] : [],
      low: p.active && st.qty < p.reorder_level, // low = below the reorder level
    };
  });

  // ---------- 2. Enrich sales (revenue, cost, commission) ----------
  // Sales outside events (direct selling) use the costing sheet of the event closest in date to the sale,
  // so adding a new sheet later never changes the profit of past sales.
  const dayNum = (d) => Date.parse(d + 'T00:00:00Z') / 86400000;
  const nearestSheet = (line, date) => {
    let best = null;
    for (const e of events) {
      const cost = line === '30ml' ? e.plan_cost_30 : line === '10ml' ? e.plan_cost_10 : 0;
      if (!(cost > 0)) continue;
      const t = dayNum(date), a = dayNum(e.start_date), b = dayNum(e.end_date);
      const dist = t < a ? a - t : t > b ? t - b : 0;
      if (!best || dist < best.dist || (dist === best.dist && e.start_date < best.start)) best = { dist, start: e.start_date, cost, from: e.name };
    }
    return best;
  };
  // Cost per bottle "now" per size = the cost in the most recent event costing sheet that has one.
  // Used for sales outside events (e.g. direct selling) when there is no stock cost.
  const sheetCost = {};
  for (const e of [...events].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))) {
    if (!sheetCost['30ml'] && e.plan_cost_30 > 0) sheetCost['30ml'] = { cost: e.plan_cost_30, from: e.name };
    if (!sheetCost['10ml'] && e.plan_cost_10 > 0) sheetCost['10ml'] = { cost: e.plan_cost_10, from: e.name };
  }

  // Agent commission tier is decided by the agent's total bottles on the same date (one "order").
  const agentOrderQty = new Map();
  salesRaw.filter((s) => s.channel === 'agent' && s.agent_id).forEach((s) => {
    const key = `${s.agent_id}|${s.date}`;
    agentOrderQty.set(key, (agentOrderQty.get(key) || 0) + s.qty);
  });

  const sales = salesRaw
    .map((s) => {
      const ev = s.event_id ? eventById.get(s.event_id) : null;
      let commission = 0;
      if (s.channel === 'booth' && ev) commission = s.qty * ev.commission_rate;
      if (s.channel === 'agent' && s.agent_id) {
        commission = s.qty * agentRate(settings.agent_tiers, agentOrderQty.get(`${s.agent_id}|${s.date}`) || 0);
      }
      const revenue = s.qty * s.unit_price;
      // Event sales use the event's own cost/bottle (from its costing sheet) when one is set;
      // otherwise the moving-average stock cost.
      const line = productById.get(s.product_id)?.line;
      const evCost = ev && (line === '30ml' ? ev.plan_cost_30 : line === '10ml' ? ev.plan_cost_10 : 0);
      const stockCost = saleCost.get(s.id) || 0;
      // Order: the event's own sheet cost → the latest costing sheet's cost → moving-average stock cost.
      const near = ev ? null : nearestSheet(line, s.date);
      const unitCost = evCost > 0 ? evCost : near ? near.cost : stockCost;
      const costFrom = evCost > 0 ? 'event sheet' : near ? `${near.from} sheet` : stockCost > 0 ? 'stock' : 'none';
      const cogs = s.qty * unitCost;
      return {
        ...s,
        // Show the sale's own scent when set (stock still follows product_id).
        product_name: s.scent ? `${s.scent} (${productById.get(s.product_id)?.line || ''})` : productById.get(s.product_id)?.name || '?',
        event_name: ev?.name || null,
        agent_name: s.agent_id ? agentById.get(s.agent_id)?.name || null : null,
        unit_cost: r2(unitCost),
        cost_from: costFrom,
        revenue: r2(revenue),
        cogs: r2(cogs),
        cogs_exact: cogs, // unrounded, so totals match the costing sheets to the sen
        commission: r2(commission),
        profit: r2(revenue - cogs - commission),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

  // ---------- 3a. Blended cost per size (leftover + restock, from the moving average) ----------
  // Same idea as the "blended variable cost / bottle" in the costing sheet.
  const lineStats = {};
  for (const size of ['30ml', '10ml']) {
    const items = stock.filter((p) => p.line === size && p.active);
    const units = items.reduce((a, p) => a + Math.max(p.on_hand, 0), 0);
    const value = items.reduce((a, p) => a + p.stock_value, 0);
    let cost = units > 0 ? value / units : 0;
    if (!cost) {
      // No stock on hand: fall back to the latest batch cost for that size.
      const ids = new Set(items.map((p) => p.id));
      const last = batches.filter((b) => ids.has(b.product_id)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      cost = last ? last.unit_cost : 0;
    }
    lineStats[size] = { available: units, cost: r2(cost) };
  }

  // ---------- 3b. Event costing ----------
  const eventsOut = events.map((e) => {
    const evSales = sales.filter((s) => s.event_id === e.id);
    const evCosts = costs.filter((c) => c.event_id === e.id).sort((a, b) => a.id - b.id);
    const bottles = evSales.reduce((a, s) => a + s.qty, 0);
    const revenue = evSales.reduce((a, s) => a + s.revenue, 0);
    const cogs = evSales.reduce((a, s) => a + s.cogs_exact, 0);
    const commission = evSales.reduce((a, s) => a + s.commission, 0);
    const wages = e.worker_days * e.daily_wage;
    const otherCosts = evCosts.reduce((a, c) => a + c.amount, 0);
    const fixed = wages + otherCosts;
    const totalCosts = fixed + commission;
    const profit = revenue - cogs - totalCosts;
    // break-even in bottles: fixed costs / contribution per bottle
    let breakEven = null;
    if (bottles > 0) {
      const contribution = (revenue - cogs - commission) / bottles;
      breakEven = contribution > 0 ? Math.ceil(fixed / contribution) : null;
    }
    return {
      ...e,
      costs: evCosts,
      bottles,
      revenue: r2(revenue),
      cogs: r2(cogs),
      wages: r2(wages),
      commission: r2(commission),
      other_costs: r2(otherCosts),
      total_costs: r2(totalCosts),
      profit: r2(profit),
      cash_result: r2(revenue - totalCosts),
      margin_pct: revenue > 0 ? r2((profit / revenue) * 100) : 0,
      break_even_bottles: breakEven,
      profit_per_day: r2(profit / Math.max(1, (new Date(e.end_date) - new Date(e.start_date)) / 86400000 + 1)),
      plan: planEvent(e, fixed, lineStats),
    };
  });

  // ---------- 4. Cash ledger ----------
  const ledger = [];
  const push = (e) => ledger.push({ ...e, month: monthOf(e.date) });

  for (const s of sales) {
    push({
      key: `sale-${s.id}`, date: s.date, type: 'in', category: 'Sales', source: 'Sale', amount: s.revenue,
      description: `${s.qty} × ${s.product_name}${s.event_name ? ' @ ' + s.event_name : ''}${s.channel === 'agent' && s.agent_name ? ' (agent ' + s.agent_name + ')' : ''}${s.channel === 'online' ? ' (online)' : ''}`,
    });
    if (s.channel === 'agent' && s.commission > 0) {
      push({
        key: `agent-${s.id}`, date: s.date, type: 'out', category: 'Agent commission', source: 'Agent', amount: s.commission,
        description: `${s.agent_name || 'Agent'}: ${s.qty} × ${s.product_name}`,
      });
    }
  }
  // Stock purchases: always one line per scent, e.g. "7 × Sweet Roma (30ml)" (also for costing-sheet restocks).
  for (const b of batches) {
    if (!b.cash_paid) continue;
    push({
      key: `batch-${b.id}`, date: b.date, type: 'out', category: 'Stock purchase', source: 'Stock',
      amount: r2(b.qty * b.unit_cost),
      description: `${b.qty} × ${productById.get(b.product_id)?.name || '?'}${b.supplier ? ' from ' + b.supplier : ''}`,
    });
  }
  for (const e of eventsOut) {
    for (const c of e.costs) {
      if (!c.amount) continue;
      // A negative event cost is extra income for that event (e.g. a tip or extra payment).
      push({
        key: `cost-${c.id}`, date: c.date || e.start_date, type: c.amount < 0 ? 'in' : 'out', category: c.category, source: 'Event', event_end: e.end_date,
        amount: Math.abs(c.amount), description: `${e.name}: ${c.description || c.category}`,
      });
    }
    if (e.wages > 0) {
      push({ key: `wage-${e.id}`, date: e.end_date, type: 'out', category: 'Worker wages', source: 'Event', event_end: e.end_date, amount: e.wages, description: `${e.name}: ${e.worker_days} worker-day(s)` });
    }
    const boothComm = sales.filter((s) => s.event_id === e.id && s.channel === 'booth').reduce((a, s) => a + s.commission, 0);
    if (boothComm > 0) {
      push({ key: `comm-${e.id}`, date: e.end_date, type: 'out', category: 'Worker commission', source: 'Event', event_end: e.end_date, amount: r2(boothComm), description: `${e.name}: booth commission` });
    }
  }
  for (const t of txs) {
    push({ key: `tx-${t.id}`, tx_id: t.id, date: t.date, type: t.type, category: t.category, source: 'Manual', amount: t.amount, description: t.description });
  }

  // Within one day: money in (sales) first, then other costs, and worker payments last
  // (workers are paid after the day's work is done).
  const dayOrder = (l) => (l.type === 'in' ? 0 : /worker|helper|wage/i.test(l.category) ? 2 : 1);
  ledger.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : dayOrder(a) - dayOrder(b) || (a.key < b.key ? -1 : 1)));
  // Entries dated in the future (e.g. wages of an event that has not finished yet) are shown as
  // "upcoming" and are not counted in the balance or the monthly report until their date arrives.
  const today = new Date().toLocaleDateString('en-CA');
  // Opening cash is the bank balance on `opening_cash_date`. Anything dated on or before that day
  // is already inside that balance, so it is listed but not subtracted/added again.
  const openingDate = settings.opening_cash_date || '';
  let balance = Number(settings.opening_cash) || 0;
  for (const l of ledger) {
    if (openingDate && l.date <= openingDate) { l.before_opening = true; l.balance = null; continue; }
    if (l.date > today) { l.upcoming = true; l.balance = r2(balance); continue; }
    balance += l.type === 'in' ? l.amount : -l.amount;
    l.balance = r2(balance);
  }
  const cashBalance = r2(balance);

  // ---------- 5. Monthly report ----------
  const months = new Map();
  const M = (m) => {
    if (!months.has(m)) {
      months.set(m, {
        month: m, bottles: 0, revenue: 0, cogs: 0, stock_loss: 0, event_costs: 0, wages: 0, commissions: 0,
        other_expenses: 0, other_income: 0, cash_in: 0, cash_out: 0,
      });
    }
    return months.get(m);
  };
  // Event sales count in the month the event ends (same as its costs), so one event = one month.
  for (const s of sales) {
    const ev = s.event_id ? eventById.get(s.event_id) : null;
    const m = M(monthOf(ev ? ev.end_date : s.date));
    m.bottles += s.qty; m.revenue += s.revenue;
    if (!ev) m.cogs += s.cogs; // direct sales: same rounded cost shown on the Sales page
  }
  // Event bottle cost: the event's total (rounded once, like the costing sheet), in the event's month.
  for (const e of eventsOut) if (e.cogs) M(monthOf(e.end_date)).cogs += e.cogs;
  // A manual stock count only corrects the number on hand; it is not a loss (sold bottles are already costed in sales).
  for (const a of adjustments) { if (a.reason !== 'Stock count') M(monthOf(a.date)).stock_loss += a.qty * (adjCost.get(a.id) || 0); }
  for (const l of ledger) {
    if (l.upcoming) continue;
    const m = M(l.month);
    if (l.type === 'in') m.cash_in += l.amount; else m.cash_out += l.amount;
    if (l.source === 'Event') {
      // Profit: an event's costs count in the month the event ends, and only once it has ended
      // (e.g. a booth fee paid early). Cash above still uses the payment date.
      if (l.event_end > today) continue;
      const pm = M(monthOf(l.event_end));
      if (l.type === 'in') pm.event_costs -= l.amount;
      else if (l.category === 'Worker wages' || /worker|helper|wage/i.test(l.category)) pm.wages += l.amount;
      else if (l.category === 'Worker commission') pm.commissions += l.amount;
      else pm.event_costs += l.amount;
      continue;
    }
    if (l.source === 'Agent') m.commissions += l.amount;
    else if (l.source === 'Manual' && !NON_OPERATING.has(l.category)) {
      if (l.type === 'out') m.other_expenses += l.amount; else m.other_income += l.amount;
    }
  }
  const monthly = [...months.values()]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => {
      const gross = m.revenue - m.cogs;
      const net = gross - m.stock_loss - m.event_costs - m.wages - m.commissions - m.other_expenses + m.other_income;
      const out = {};
      for (const k of Object.keys(m)) out[k] = typeof m[k] === 'number' ? r2(m[k]) : m[k];
      return { ...out, gross_profit: r2(gross), net_profit: r2(net), net_cash: r2(m.cash_in - m.cash_out) };
    });

  return { settings, products, stock, sales, events: eventsOut, agents, ledger, monthly, cashBalance, batches, adjustments, productById, sheetCost };
}

// compute() is called by many routes, sometimes several times per request. Its result only changes when
// the data changes (or the date: "upcoming" entries), so reuse it until then. Callers only read it.
let memo = null;
function compute() {
  const key = `${dbVersion()}|${new Date().toLocaleDateString('en-CA')}`;
  if (memo && memo.key === key) return memo.value;
  const value = computeFresh();
  memo = { key, value };
  return value;
}

module.exports = { compute, agentRate, r2, NON_OPERATING };
