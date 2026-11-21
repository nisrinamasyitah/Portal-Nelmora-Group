import { Loading, PageHead, useApi } from '../components.jsx';
import { fmtDate, rm } from '../utils.js';

// Perfume cost per bottle, from the costing sheets (event plans) and the production/restock batches in them.
const fmt2 = (n) => 'RM ' + Number(n).toFixed(2);
const sizeOf = (name) => (/10ml/.test(name) ? '10ml' : '30ml');
const sheetOf = (note) => (note || '').match(/^(\d{4}) sheet/)?.[1];

export default function PerfumeCost() {
  const events = useApi('/events');
  const perBottle = useApi('/direct-profit');
  const batches = useApi('/batches');
  if (!events.data || !batches.data) return <Loading state={events.data ? batches : events} />;

  const sheets = [...events.data]
    .filter((e) => e.plan_cost_30 > 0 || e.plan_cost_10 > 0)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));

  // One row per sheet restock (same sheet, date, size and cost/bottle), e.g. 7 scents × 6 bottles = 42.
  const groups = new Map();
  for (const b of batches.data.filter((x) => sheetOf(x.note))) {
    const size = sizeOf(b.product_name);
    const key = [sheetOf(b.note), b.date, size, b.unit_cost].join('|');
    const g = groups.get(key) || { sheet: sheetOf(b.note), date: b.date, size, cost: b.unit_cost, qty: 0, scents: [], detail: (b.note || '').replace(/^[^:]*:\s*/, '').replace(/ \(dated on the event.*$/, '') };
    g.qty += b.qty;
    if (!/scent not recorded/.test(b.product_name)) g.scents.push(`${b.product_name.replace(/ \((10|30)ml\)$/, '')} ${b.qty}`);
    groups.set(key, g);
  }
  const prod = [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.size < b.size ? 1 : -1));

  return (
    <>
      <PageHead title="Perfume cost" sub="Cost per bottle from your costing sheets: perfume, bottle, sticker and box." />

      <div className="kpis per-bottle">
        {(perBottle.data || []).filter((l) => l.cost > 0).map((l) => (
          <div key={l.line}>
            <span>{l.line} · cost per bottle now</span>
            <b>{fmt2(l.cost)}</b>
            <small>From {l.from} sheet · sells {rm(l.price)} · profit {rm(l.profit)} / bottle</small>
          </div>
        ))}
      </div>

      <div className="grid cost-grid" style={{ marginTop: 20 }}>
        <div className="card">
          <h2>Cost per bottle in each sheet</h2>
          <table className="compact">
            <thead><tr><th>Sheet</th><th>Event</th><th className="num">30ml</th><th className="num">10ml</th></tr></thead>
            <tbody>
              {sheets.map((e, i) => (
                <tr key={e.id}>
                  <td>{String(i + 1).padStart(4, '0')}</td>
                  <td>{e.name}<div className="row-note">{fmtDate(e.start_date)}</div></td>
                  <td className="num">{e.plan_cost_30 > 0 ? fmt2(e.plan_cost_30) : <span className="muted">–</span>}</td>
                  <td className="num">{e.plan_cost_10 > 0 ? fmt2(e.plan_cost_10) : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Production &amp; restock in the sheets</h2>
          <table className="compact">
            <thead><tr><th>Batch</th><th className="num">Bottles</th><th className="num">Cost / bottle</th><th className="num">Total</th></tr></thead>
            <tbody>
              {prod.map((g) => (
                <tr key={[g.sheet, g.date, g.size, g.cost].join('|')}>
                  <td>
                    <span className={'badge size-' + g.size}>{g.size}</span> <b className="small">{g.sheet} sheet</b> <span className="row-note nowrap">{fmtDate(g.date)}</span>
                    <div className="row-note">{g.scents.length ? g.scents.join(', ') : g.detail}</div>
                  </td>
                  <td className="num">{g.qty}</td>
                  <td className="num">{fmt2(g.cost)}</td>
                  <td className="num">{rm(g.qty * g.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{prod.reduce((a, g) => a + g.qty, 0)}</td><td /><td className="num">{rm(prod.reduce((a, g) => a + g.qty * g.cost, 0))}</td></tr></tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
