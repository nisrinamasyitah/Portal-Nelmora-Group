const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'nelmora.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Write recent changes from the WAL side file into nelmora.db (now and every 5 minutes),
// so copying nelmora.db on its own is always a complete backup.
const checkpoint = () => { try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* busy: try next time */ } };
checkpoint();
setInterval(checkpoint, 5 * 60 * 1000).unref();

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  line TEXT NOT NULL DEFAULT '10ml',
  gender TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1
);

-- Stock coming IN (production / restock / opening stock)
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  date TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  supplier TEXT DEFAULT '',
  note TEXT DEFAULT '',
  cash_paid INTEGER NOT NULL DEFAULT 1   -- 0 = opening / carried-forward stock, no cash leaves
);

-- Stock going OUT without a sale (damaged, testers, gifts, lost)
CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  date TEXT NOT NULL,
  qty INTEGER NOT NULL,                  -- units removed (positive number)
  reason TEXT DEFAULT '',
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  worker_days REAL NOT NULL DEFAULT 0,
  daily_wage REAL NOT NULL DEFAULT 0,
  commission_rate REAL NOT NULL DEFAULT 0, -- RM per bottle sold at the booth
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS event_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  description TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  note TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  channel TEXT NOT NULL DEFAULT 'booth',  -- booth | agent | online | other
  event_id INTEGER REFERENCES events(id),
  agent_id INTEGER REFERENCES agents(id),
  note TEXT DEFAULT ''
);

-- Manual cash entries (capital, withdrawals, marketing, tools, licences ...)
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL,                      -- in | out
  category TEXT NOT NULL DEFAULT 'Other',
  description TEXT DEFAULT '',
  amount REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_event ON sales(event_id);
CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
`);

// Migrations: event plan (target bottles + selling price per size, set before the event)
const eventCols = new Set(db.prepare('PRAGMA table_info(events)').all().map((c) => c.name));
for (const col of ['plan_qty_30', 'plan_price_30', 'plan_qty_10', 'plan_price_10', 'plan_cost_30', 'plan_cost_10']) {
  if (!eventCols.has(col)) db.exec(`ALTER TABLE events ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`);
}

// Migration: scent notes per product (from the catalog)
const productCols = new Set(db.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
// Migration: a sale can carry its scent separately from the stock product (e.g. when stock is counted by hand)
const saleCols = new Set(db.prepare('PRAGMA table_info(sales)').all().map((c) => c.name));
if (!saleCols.has('scent')) db.exec("ALTER TABLE sales ADD COLUMN scent TEXT NOT NULL DEFAULT ''");
if (!productCols.has('notes')) db.exec("ALTER TABLE products ADD COLUMN notes TEXT NOT NULL DEFAULT ''");

const DEFAULT_SETTINGS = {
  business_name: 'Nelmora',
  opening_cash: 0,
  opening_cash_date: '', // '' = opening cash is from before the first entry
  default_daily_wage: 100,
  default_commission: 3,
  agent_tiers: [
    { min: 10, rate: 1.5 },
    { min: 20, rate: 2 },
    { min: 50, rate: 2.5 },
  ],
};

function seedDefaults() {
  const has = db.prepare('SELECT 1 FROM settings WHERE key = ?');
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!has.get(k)) put.run(k, JSON.stringify(v));
  }
  const count = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO products (name, line, gender, price, reorder_level) VALUES (?,?,?,?,?)');
    ins.run('Signature 30ml', '30ml', '', 60, 10);
    for (let i = 1; i <= 6; i++) ins.run(`Women ${i} (10ml)`, '10ml', 'Women', 16, 10);
    for (let i = 1; i <= 5; i++) ins.run(`Men ${i} (10ml)`, '10ml', 'Men', 16, 10);
  }
}
seedDefaults();

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

module.exports = { db, dbPath, getSettings, DEFAULT_SETTINGS };
