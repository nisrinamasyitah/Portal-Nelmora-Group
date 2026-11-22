const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// The database is one SQLite file.
// - On your computer (npm start / npm run dev): data/nelmora.db on disk.
// - On Netlify: the same file is kept in Netlify Blobs; netlify/functions/api.mjs loads it into memory
//   for each request and saves it back after changes (see useDatabase / serializeDatabase below).

const SCHEMA = `
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

-- Staff logins (the owner logs in with PORTAL_EMAIL / PORTAL_PASSWORD instead).
-- role 'designer' sees only: her design jobs and fees, stock counts, event dates, scent notes.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'designer',
  pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL DEFAULT (date('now'))
);

-- Design jobs (posters etc.). The owner assigns them; the designer updates status and file link.
-- fee is fixed when the job is created (default RM20 + 6%), so changing the default later doesn't rewrite old jobs.
-- Paying a job adds a "Design" cash-out entry (transaction_id); deleting that entry makes the job unpaid again.
CREATE TABLE IF NOT EXISTS designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  brief TEXT DEFAULT '',
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES users(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo',      -- todo | doing | done
  file_link TEXT DEFAULT '',
  staff_note TEXT DEFAULT '',
  fee REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL DEFAULT (date('now')),
  done_date TEXT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_designs_assignee ON designs(assignee_id);
`;

const DEFAULT_SETTINGS = {
  business_name: 'Nelmora',
  opening_cash: 0,
  opening_cash_date: '', // '' = opening cash is from before the first entry
  default_daily_wage: 100,
  default_commission: 3,
  design_fee_base: 20,  // RM per design
  design_fee_pct: 6,    // % added on top of the base (RM20 + 6% = RM21.20)
  agent_tiers: [
    { min: 10, rate: 1.5 },
    { min: 20, rate: 2 },
    { min: 50, rate: 2.5 },
  ],
};

// Tables, migrations and defaults. Safe to run on every open.
function prepare(d) {
  d.pragma('foreign_keys = ON');
  d.exec(SCHEMA);

  // Migrations: event plan (target bottles + selling price per size, set before the event)
  const eventCols = new Set(d.prepare('PRAGMA table_info(events)').all().map((c) => c.name));
  for (const col of ['plan_qty_30', 'plan_price_30', 'plan_qty_10', 'plan_price_10', 'plan_cost_30', 'plan_cost_10']) {
    if (!eventCols.has(col)) d.exec(`ALTER TABLE events ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`);
  }
  // Migration: a sale can carry its scent separately from the stock product (e.g. when stock is counted by hand)
  const saleCols = new Set(d.prepare('PRAGMA table_info(sales)').all().map((c) => c.name));
  if (!saleCols.has('scent')) d.exec("ALTER TABLE sales ADD COLUMN scent TEXT NOT NULL DEFAULT ''");
  // Migration: scent notes per product (from the catalog)
  const productCols = new Set(d.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
  if (!productCols.has('notes')) d.exec("ALTER TABLE products ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  // Migration: a design can be marked paid outside the portal (money already in cash flow elsewhere,
  // e.g. inside a worker payment), so no new cash entry is made.
  const designCols = new Set(d.prepare('PRAGMA table_info(designs)').all().map((c) => c.name));
  if (!designCols.has('paid_on')) d.exec('ALTER TABLE designs ADD COLUMN paid_on TEXT');
  if (!designCols.has('paid_note')) d.exec("ALTER TABLE designs ADD COLUMN paid_note TEXT NOT NULL DEFAULT ''");
  // Migration: where a staff member gets job notifications (can differ from her sign-in email).
  const userCols = new Set(d.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!userCols.has('notify_email')) d.exec("ALTER TABLE users ADD COLUMN notify_email TEXT NOT NULL DEFAULT ''");
  // Migration: staff account control (last sign-in, when the owner froze the account).
  if (!userCols.has('last_login')) d.exec('ALTER TABLE users ADD COLUMN last_login TEXT');
  if (!userCols.has('frozen_at')) d.exec('ALTER TABLE users ADD COLUMN frozen_at TEXT');

  const has = d.prepare('SELECT 1 FROM settings WHERE key = ?');
  const put = d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!has.get(k)) put.run(k, JSON.stringify(v));
  }
  const count = d.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (count === 0) {
    const ins = d.prepare('INSERT INTO products (name, line, gender, price, reorder_level) VALUES (?,?,?,?,?)');
    ins.run('Signature 30ml', '30ml', '', 60, 10);
    for (let i = 1; i <= 6; i++) ins.run(`Women ${i} (10ml)`, '10ml', 'Women', 16, 10);
    for (let i = 1; i <= 5; i++) ins.run(`Men ${i} (10ml)`, '10ml', 'Men', 16, 10);
  }
  return d;
}

// ---------------------------------------------------------------- current database
// `db` always points at the database in use. On Netlify it is swapped per request, so every
// module keeps using `db.prepare(...)` without knowing where the file lives.
let current = null;
let dbPath = '(in memory)';

const db = new Proxy({}, {
  get(_t, prop) {
    if (!current) openLocalFile();
    const v = current[prop];
    return typeof v === 'function' ? v.bind(current) : v;
  },
});

// On your computer: data/nelmora.db (or DATA_DIR/nelmora.db).
function openLocalFile() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'nelmora.db');
  current = new Database(dbPath);
  current.pragma('journal_mode = WAL');
  prepare(current);
  // Write recent changes from the WAL side file into nelmora.db (now and every 5 minutes),
  // so copying nelmora.db on its own is always a complete backup.
  const checkpoint = () => { try { current.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* busy: try next time */ } };
  checkpoint();
  setInterval(checkpoint, 5 * 60 * 1000).unref();
  return current;
}

// Copy of database file bytes that SQLite can open in memory. Files from your computer use WAL mode
// (header bytes 18–19 = 2), which can't be opened from memory; switching them to 1 changes nothing in the data.
function memoryBytes(buf) {
  const b = Buffer.from(buf);
  if (b.length > 19 && b.toString('latin1', 0, 15) === 'SQLite format 3' && (b[18] === 2 || b[19] === 2)) { b[18] = 1; b[19] = 1; }
  return b;
}

// Open a database from file bytes (a backup, or the copy kept in Netlify Blobs). Empty → new database.
function openFromBuffer(buf) {
  return prepare(buf && buf.length ? new Database(memoryBytes(buf)) : new Database(':memory:'));
}

// Netlify: use this database for the current request.
function useDatabase(d) { if (current && current !== d) { try { current.close(); } catch { /* already closed */ } } current = d; }

// Check a backup file before restoring it: it must open and have the portal's tables.
function checkBackup(buf) {
  let d, tables;
  try {
    d = new Database(memoryBytes(buf));
    tables = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  } catch {
    try { d?.close(); } catch { /* not open */ }
    throw new Error('This is not a Nelmora backup file (.db).');
  }
  try {
    for (const t of ['settings', 'products', 'batches', 'sales', 'events', 'transactions']) {
      if (!tables.has(t)) throw new Error(`This file is missing the "${t}" table, so it is not a Nelmora backup.`);
    }
    return { sales: d.prepare('SELECT COUNT(*) c FROM sales').get().c, products: d.prepare('SELECT COUNT(*) c FROM products').get().c };
  } finally { d.close(); }
}

// Replace all data with a backup file. On your computer the file on disk is replaced
// (the old one is kept as nelmora-before-restore-<time>.db); on Netlify the function saves it after the request.
function restoreDatabase(buf) {
  const info = checkBackup(buf);
  if (current && dbPath !== '(in memory)') {
    current.close();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dbPath, path.join(path.dirname(dbPath), `nelmora-before-restore-${stamp}.db`));
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true });
    fs.writeFileSync(dbPath, Buffer.from(buf));
    current = null;
    openLocalFile();
  } else {
    useDatabase(openFromBuffer(buf));
  }
  return info;
}

function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

module.exports = {
  db,
  get dbPath() { if (!current) openLocalFile(); return dbPath; },
  getSettings, DEFAULT_SETTINGS, openFromBuffer, useDatabase, checkBackup, restoreDatabase,
};
