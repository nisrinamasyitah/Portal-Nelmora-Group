// Optional: fills the portal with SAMPLE data so you can see every screen working.
// Run with:  npm run seed:demo      (only works on an empty database)
// To start fresh afterwards: stop the server and delete the data/ folder.
const { db } = require('./db');

if (db.prepare('SELECT COUNT(*) c FROM batches').get().c > 0 || db.prepare('SELECT COUNT(*) c FROM sales').get().c > 0) {
  console.log('Database already has stock or sales. Demo data not added.');
  process.exit(0);
}

const products = db.prepare('SELECT * FROM products ORDER BY id').all();
const sig = products[0];
const tens = products.slice(1);

const run = db.transaction(() => {
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('1000', 'opening_cash');

  const batch = db.prepare('INSERT INTO batches (product_id, date, qty, unit_cost, supplier, note, cash_paid) VALUES (?,?,?,?,?,?,1)');
  tens.forEach((p) => batch.run(p.id, '2026-08-10', 17, 6.5, 'MYPARFUME', 'First production (sample data)'));
  batch.run(sig.id, '2026-09-15', 30, 24, 'MYPARFUME', 'Signature launch batch (sample data)');

  const ev = db.prepare('INSERT INTO events (name, location, start_date, end_date, worker_days, daily_wage, commission_rate) VALUES (?,?,?,?,?,?,?)');
  const e1 = ev.run("People's Picnic Vol. 4 (sample)", 'Taman Botani, Putrajaya', '2026-08-29', '2026-08-31', 3, 100, 3).lastInsertRowid;
  const e2 = ev.run('Bazaar Weekend (sample)', 'Cyberjaya', '2026-10-24', '2026-10-25', 2, 100, 3).lastInsertRowid;

  const cost = db.prepare('INSERT INTO event_costs (event_id, date, category, description, amount) VALUES (?,?,?,?,?)');
  cost.run(e1, '2026-08-20', 'Booth fee', 'Booth rental', 350);
  cost.run(e1, '2026-08-29', 'Transport', 'Petrol + toll', 60);
  cost.run(e1, '2026-08-29', 'Banner / printing', 'Backdrop banner', 85);
  cost.run(e2, '2026-10-15', 'Booth fee', 'Booth rental', 200);

  const sale = db.prepare('INSERT INTO sales (date, product_id, qty, unit_price, channel, event_id, agent_id) VALUES (?,?,?,?,?,?,?)');
  const pattern = [3, 5, 2, 6, 4, 3, 5, 4, 2, 3, 4];
  tens.slice(0, 5).forEach((p, i) => sale.run('2026-08-30', p.id, pattern[i], 16, 'booth', e1, null));
  tens.slice(5).forEach((p, i) => sale.run('2026-08-31', p.id, pattern[i + 5] - 1, 16, 'booth', e1, null));
  sale.run('2026-09-20', sig.id, 4, 60, 'online', null, null);

  const ag = db.prepare('INSERT INTO agents (name, phone) VALUES (?,?)').run('Sample Agent', '').lastInsertRowid;
  sale.run('2026-10-05', tens[0].id, 6, 16, 'agent', null, ag);
  sale.run('2026-10-05', tens[1].id, 6, 16, 'agent', null, ag);

  const tx = db.prepare('INSERT INTO transactions (date, type, category, description, amount) VALUES (?,?,?,?,?)');
  tx.run('2026-07-25', 'out', 'Registration / licences', 'SSM registration (sample)', 60);
  tx.run('2026-09-01', 'out', 'Marketing', 'Instagram ads (sample)', 50);
  tx.run('2026-09-10', 'in', 'Capital injection', 'Personal savings (sample)', 500);

  db.prepare('INSERT INTO adjustments (product_id, date, qty, reason) VALUES (?,?,?,?)').run(tens[2].id, '2026-09-02', 1, 'Tester');
});
run();
console.log('Sample data added. Open the portal to look around.');
