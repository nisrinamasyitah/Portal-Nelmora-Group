import { Link } from 'react-router-dom';
import { Loading, PageHead, useApi } from '../components.jsx';
import { fmtDate, rm } from '../utils.js';

// Perfume cost per bottle, taken from the costing sheets (0001, 0002 …): the blended cost in each sheet,
// and every production / restock in them.
const fmt2 = (n) => 'RM ' + Number(n).toFixed(2);

export default function PerfumeCost() {
  const pc = useApi('/perfume-cost');
  if (!pc.data) return <Loading state={pc} />;
  const { now, sheets, production } = pc.data;

  return (
    <>
      <PageHead title="Perfume cost" sub="Cost per bottle from your costing sheets: perfume, bottle, sticker and box." />

      <div className="kpis per-bottle">
        {now.filter((l) => l.cost > 0).map((l) => (
          <div key={l.line}>
            <span>{l.line} · cost per bottle now</span>
            <b>{fmt2(l.cost)}</b>
            <small>From costing {l.from} · sells {rm(l.price)} · profit {rm(l.profit)} / bottle</small>
          </div>
        ))}
      </div>

      <div className="grid cost-grid" style={{ marginTop: 20 }}>
        <div className="card">
          <h2>Cost per bottle in each sheet <Link to="/costing">Costing</Link></h2>
          <table className="compact">
            <thead><tr><th>Sheet</th><th>Costing</th><th className="num">30ml</th><th className="num">10ml</th></tr></thead>
            <tbody>
              {sheets.map((x) => (
                <tr key={x.code}>
                  <td className="nowrap"><b>{x.code}</b></td>
                  <td>{x.event_name || x.title}<div className="row-note">{fmtDate(x.start_date)}{x.end_date ? ` – ${fmtDate(x.end_date)}` : ' – today'}{x.event_name ? '' : ' · direct selling'}</div></td>
                  <td className="num">{x.cost['30ml'] > 0 ? fmt2(x.cost['30ml']) : <span className="muted">–</span>}</td>
                  <td className="num">{x.cost['10ml'] > 0 ? fmt2(x.cost['10ml']) : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>Blended cost per bottle: leftover + new restock, as in section 3 of each sheet.</p>
        </div>

        <div className="card">
          <h2>Production &amp; restock in the sheets</h2>
          <table className="compact">
            <thead><tr><th>Batch</th><th className="num">Bottles</th><th className="num">Cost / bottle</th><th className="num">Total</th></tr></thead>
            <tbody>
              {production.map((g, i) => (
                <tr key={i}>
                  <td>
                    <span className={'badge size-' + g.size}>{g.size}</span> <b className="small">{g.code} sheet</b>{' '}
                    <span className="row-note nowrap">{g.date ? fmtDate(g.date) : 'first production'}</span>
                    <div className="row-note">{g.detail}</div>
                  </td>
                  <td className="num">{g.qty}</td>
                  <td className="num">{fmt2(g.cost)}</td>
                  <td className="num">{rm(g.qty * g.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{production.reduce((a, g) => a + g.qty, 0)}</td><td /><td className="num">{rm(production.reduce((a, g) => a + g.qty * g.cost, 0))}</td></tr></tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
