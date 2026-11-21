import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { Empty, Field, FormModal, Loading, PageHead, Stat, confirmDelete, useApi } from '../components.jsx';
import { COLORS, downloadCSV, fmtDate, monthLabel, monthShort, rm, today, tone } from '../utils.js';

const IN_CATS = ['Capital injection', 'Other income'];

// Each category gets its own colour so the list is easy to scan.
const CAT_CLASS = [
  [/^sales$/i, 'cat-sales'],
  [/income|capital/i, 'cat-income'],
  [/booth|tapak|deposit|table/i, 'cat-booth'],
  [/worker|wage|helper/i, 'cat-worker'],
  [/platform|ads|website|tools/i, 'cat-platform'],
  [/stock|packaging|printing|banner|tester/i, 'cat-stock'],
  [/commission/i, 'cat-commission'],
  [/transport|parking|food/i, 'cat-transport'],
  [/marketing/i, 'cat-marketing'],
  [/owner|withdrawal|licen/i, 'cat-owner'],
];
const catClass = (c) => CAT_CLASS.find(([re]) => re.test(c))?.[1] || 'cat-other';
const OUT_CATS = ['Stock purchase', 'Marketing', 'Packaging / printing', 'Website & tools', 'Registration / licences', 'Transport', 'Owner withdrawal', 'Other expense'];

function TxModal({ onClose }) {
  const [f, setF] = useState({ type: 'out', date: today(), category: OUT_CATS[0], description: '', amount: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cats = f.type === 'in' ? IN_CATS : OUT_CATS;
  return (
    <FormModal title="Add cash entry" onClose={onClose} onSave={() => api('/transactions', { method: 'POST', body: f })}>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Sales, stock purchases, event costs, wages and agent commission are added automatically. Use this for everything else
        (capital, marketing, tools, withdrawals…).
      </p>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button type="button" className={f.type === 'out' ? 'on' : ''} onClick={() => setF((x) => ({ ...x, type: 'out', category: OUT_CATS[0] }))}>Money out</button>
        <button type="button" className={f.type === 'in' ? 'on' : ''} onClick={() => setF((x) => ({ ...x, type: 'in', category: IN_CATS[0] }))}>Money in</button>
      </div>
      <div className="row">
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required /></Field>
        <Field label="Amount (RM)"><input type="number" step="0.01" min="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} required autoFocus /></Field>
      </div>
      <Field label="Category">
        <select value={f.category} onChange={(e) => set('category', e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
      </Field>
      <Field label="Description"><input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Instagram ads" /></Field>
    </FormModal>
  );
}

export default function CashFlow() {
  const cf = useApi('/cashflow');
  const monthly = useApi('/monthly');
  const [month, setMonth] = useState('');
  const [type, setType] = useState('');
  const [modal, setModal] = useState(false);

  const entries = cf.data?.entries || [];
  const months = useMemo(() => [...new Set(entries.map((e) => e.month))].sort().reverse(), [entries]);
  const shown = entries.filter((e) => (!month || e.month === month) && (!type || e.type === type));
  const counted = shown.filter((e) => !e.upcoming);
  const inSum = counted.filter((e) => e.type === 'in').reduce((a, e) => a + e.amount, 0);
  const outSum = counted.filter((e) => e.type === 'out').reduce((a, e) => a + e.amount, 0);

  // Net profit, like the NET PROFIT box in the costing sheets: sales − perfume cost − event/worker/platform costs − other business costs.
  const netProfit = (monthly.data || []).filter((m) => !month || m.month === month).reduce((a, m) => a + m.net_profit, 0);

  // Latest entry that has already happened (entries are newest first; skip upcoming ones).
  const lastTx = entries.find((e) => !e.upcoming);
  // Everything on that last day, added together (e.g. a restock split across several scents).
  const lastDay = lastTx ? entries.filter((e) => !e.upcoming && e.date === lastTx.date) : [];
  const lastNet = lastDay.reduce((a, e) => a + (e.type === 'in' ? e.amount : -e.amount), 0);
  const lastCats = [...new Set(lastDay.map((e) => e.category))];

  if (!cf.data) return <Loading state={cf} />;

  return (
    <>
      <PageHead title="Cash flow" sub="Every ringgit in and out, with a running balance.">
        <button onClick={() => downloadCSV('nelmora-cashflow.csv', shown.map((e) => ({ date: e.date, type: e.type, category: e.category, description: e.description, amount: e.amount, balance: e.balance })))}>Export CSV</button>
        <button className="primary" onClick={() => setModal(true)}>+ Add cash entry</button>
      </PageHead>

      <div className="stats">
        <Stat
          label="Current balance"
          value={rm(cf.data.balance)}
          tone={tone(cf.data.balance)}
          sub={lastTx ? `Last update ${fmtDate(lastTx.date)} · ${lastNet >= 0 ? '+' : '−'}${rm(Math.abs(lastNet))} ${lastCats.join(', ')}` : ''}
        />
        <Stat label="Money in" value={rm(inSum)} tone="pos" sub={month ? monthLabel(month) : 'All time'} />
        <Stat label="Money out" value={rm(outSum)} tone="neg" sub={month ? monthLabel(month) : 'All time'} />
        <Stat label="Net profit" value={rm(netProfit)} tone={tone(netProfit)} sub="Sales − perfume, event, worker & other costs" />
      </div>

      <div className="card">
        <h2>Cash in vs out by month</h2>
        {!monthly.data?.length ? <Empty>Nothing to chart yet.</Empty> : (
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={monthly.data.map((m) => ({ ...m, label: monthShort(m.month) }))} margin={{ left: -10, right: 8 }}>
                <CartesianGrid vertical={false} stroke={COLORS.line} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(v) => rm(v)} cursor={{ fill: 'rgba(107, 26, 46, 0.06)' }} />
                <Legend />
                <Bar dataKey="cash_in" name="Money in" fill={COLORS.pos} radius={[4, 4, 0, 0]} />
                <Bar dataKey="cash_out" name="Money out" fill={COLORS.neg} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <div className="filters">
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">In and out</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </div>
        {shown.length === 0 ? <Empty>No entries.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Description</th><th>Category</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th><th /></tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.key} className={e.upcoming ? 'upcoming' : ''}>
                    <td className="nowrap">{fmtDate(e.date)}{e.upcoming && <div className="row-note">upcoming</div>}{e.before_opening && <div className="row-note">in opening balance</div>}</td>
                    <td>{e.description}</td>
                    <td><span className={'badge ' + catClass(e.category)}>{e.category}</span></td>
                    <td className="num pos">{e.type === 'in' ? rm(e.amount) : ''}</td>
                    <td className="num neg">{e.type === 'out' ? rm(e.amount) : ''}</td>
                    <td className="num">{e.before_opening ? '' : rm(e.balance)}</td>
                    <td className="right">
                      {e.source === 'Manual' && (
                        <button className="link danger" onClick={async () => (await confirmDelete('Delete this cash entry?', () => api(`/transactions/${e.tx_id}`, { method: 'DELETE' }))) && cf.reload()}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>
          {cf.data.opening_cash_date && <>Entries on or before {fmtDate(cf.data.opening_cash_date)} are already included in your opening cash, so they don't change the balance. </>}
          Entries with a date in the future (like wages for an event that hasn't finished) are shown as "upcoming" and only count once their date arrives.
          To change automatic entries, edit the sale, stock batch or event they came from.
        </p>
      </div>

      {modal && <TxModal onClose={(saved) => { setModal(false); if (saved) { cf.reload(); monthly.reload(); } }} />}
    </>
  );
}
