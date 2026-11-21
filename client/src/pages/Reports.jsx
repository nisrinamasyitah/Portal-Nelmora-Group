import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty, Loading, PageHead, useApi } from '../components.jsx';
import { COLORS, downloadCSV, monthLabel, monthShort, rm, tone } from '../utils.js';

const SUM_KEYS = ['bottles', 'revenue', 'cogs', 'gross_profit', 'stock_loss', 'event_costs', 'wages', 'commissions', 'other_expenses', 'other_income', 'net_profit', 'cash_in', 'cash_out', 'net_cash'];

export default function Reports() {
  const st = useApi('/monthly');
  if (!st.data) return <Loading state={st} />;
  const rows = [...st.data].reverse();
  const totals = SUM_KEYS.reduce((t, k) => ({ ...t, [k]: st.data.reduce((a, m) => a + m[k], 0) }), {});

  return (
    <>
      <PageHead title="Monthly report" sub="Profit and cash for each month. Profit counts only the cost of bottles actually sold.">
        <button onClick={() => downloadCSV('nelmora-monthly-report.csv', st.data)} disabled={!st.data.length}>Export CSV</button>
      </PageHead>

      <div className="card">
        <h2>Sales and net profit</h2>
        {!st.data.length ? <Empty>No data yet. Record sales and costs to see your months here.</Empty> : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={st.data.map((m) => ({ ...m, label: monthShort(m.month) }))} margin={{ left: -10, right: 8 }}>
                <CartesianGrid vertical={false} stroke={COLORS.line} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip formatter={(v) => rm(v)} cursor={{ fill: 'rgba(107, 26, 46, 0.06)' }} />
                <Legend />
                <Bar dataKey="revenue" name="Sales" fill={COLORS.ink} radius={[4, 4, 0, 0]} />
                <Bar dataKey="gross_profit" name="Gross profit" fill={COLORS.grey} radius={[4, 4, 0, 0]} />
                <Bar dataKey="net_profit" name="Net profit" fill={COLORS.silver} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {st.data.length > 0 && (
        <>
          <div className="card">
            <h2>Profit &amp; loss</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th><th className="num">Bottles</th><th className="num">Sales</th><th className="num">Cost of bottles</th><th className="num">Gross profit</th>
                    <th className="num">Event costs</th><th className="num">Wages</th><th className="num">Commission</th><th className="num">Other exp.</th><th className="num">Stock loss</th><th className="num">Net profit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.month}>
                      <td className="nowrap"><b>{monthLabel(m.month)}</b></td>
                      <td className="num">{m.bottles}</td><td className="num">{rm(m.revenue)}</td><td className="num">{rm(m.cogs)}</td><td className="num">{rm(m.gross_profit)}</td>
                      <td className="num">{rm(m.event_costs)}</td><td className="num">{rm(m.wages)}</td><td className="num">{rm(m.commissions)}</td>
                      <td className="num">{rm(m.other_expenses - m.other_income)}</td><td className="num">{rm(m.stock_loss)}</td>
                      <td className={'num ' + tone(m.net_profit)}><b>{rm(m.net_profit)}</b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td><td className="num">{totals.bottles}</td><td className="num">{rm(totals.revenue)}</td><td className="num">{rm(totals.cogs)}</td><td className="num">{rm(totals.gross_profit)}</td>
                    <td className="num">{rm(totals.event_costs)}</td><td className="num">{rm(totals.wages)}</td><td className="num">{rm(totals.commissions)}</td>
                    <td className="num">{rm(totals.other_expenses - totals.other_income)}</td><td className="num">{rm(totals.stock_loss)}</td><td className={'num ' + tone(totals.net_profit)}>{rm(totals.net_profit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Cash</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Month</th><th className="num">Money in</th><th className="num">Money out</th><th className="num">Net cash</th></tr></thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.month}><td><b>{monthLabel(m.month)}</b></td><td className="num">{rm(m.cash_in)}</td><td className="num">{rm(m.cash_out)}</td><td className={'num ' + tone(m.net_cash)}>{rm(m.net_cash)}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td className="num">{rm(totals.cash_in)}</td><td className="num">{rm(totals.cash_out)}</td><td className={'num ' + tone(totals.net_cash)}>{rm(totals.net_cash)}</td></tr></tfoot>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>
              Cash is higher or lower than profit when you buy stock before you sell it. Capital injections and owner withdrawals count in cash but not in profit.
            </p>
          </div>
        </>
      )}
    </>
  );
}
