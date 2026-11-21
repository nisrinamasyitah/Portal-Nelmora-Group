import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Field, FormModal, useApi } from './components.jsx';
import { rm, today } from './utils.js';

// Record sales for many products at once (e.g. the end-of-day count at a booth).
// Props: eventId (lock to an event), channel (lock the channel), agentId (lock the agent).
export default function SalesEntry({ eventId, channel: lockedChannel, agentId, onClose }) {
  const stock = useApi('/stock');
  const events = useApi('/events');
  const agents = useApi('/agents');
  const [channel, setChannel] = useState(lockedChannel || (eventId ? 'booth' : 'booth'));
  const [event, setEvent] = useState(eventId || '');
  const [agent, setAgent] = useState(agentId || '');
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState({}); // product_id -> {qty, price}

  const products = useMemo(() => (stock.data || []).filter((p) => p.active), [stock.data]);

  useEffect(() => {
    if (!event && channel === 'booth' && events.data?.length) {
      const t = today();
      const current = events.data.find((e) => e.start_date <= t && e.end_date >= t) || events.data[0];
      setEvent(current.id);
    }
  }, [events.data, channel]); // eslint-disable-line

  const line = (p) => lines[p.id] || { qty: '', price: p.price };
  const setLine = (p, patch) => setLines((l) => ({ ...l, [p.id]: { ...line(p), ...patch } }));
  const total = products.reduce((a, p) => a + (Number(line(p).qty) || 0) * (Number(line(p).price) || 0), 0);
  const bottles = products.reduce((a, p) => a + (Number(line(p).qty) || 0), 0);

  const save = () =>
    api('/sales/bulk', {
      method: 'POST',
      body: {
        date,
        channel,
        event_id: channel === 'booth' ? event : null,
        agent_id: channel === 'agent' ? agent : null,
        items: products.map((p) => ({ product_id: p.id, qty: Number(line(p).qty) || 0, unit_price: Number(line(p).price) || 0 })),
      },
    });

  return (
    <FormModal title="Record sales" wide onClose={onClose} onSave={save} saveLabel={`Save ${bottles} bottle(s)`}>
      <div className="row">
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Channel">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={!!lockedChannel}>
            <option value="booth">Booth / event</option>
            <option value="agent">Agent</option>
            <option value="online">Online</option>
            <option value="other">Other (friends, walk-in)</option>
          </select>
        </Field>
      </div>
      {channel === 'booth' && (
        <Field label="Event">
          <select value={event} onChange={(e) => setEvent(e.target.value)} disabled={!!eventId} required>
            <option value="">Choose an event…</option>
            {(events.data || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {events.data && !events.data.length && <span className="hint">Create an event first (Events page).</span>}
        </Field>
      )}
      {channel === 'agent' && (
        <Field label="Agent" hint="Commission tier is worked out from the agent's total bottles on the same date.">
          <select value={agent} onChange={(e) => setAgent(e.target.value)} disabled={!!agentId} required>
            <option value="">Choose an agent…</option>
            {(agents.data || []).filter((a) => a.active || a.id === Number(agentId)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>Product</th><th className="num">Price (RM)</th><th className="num">Qty sold</th></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}<div className="muted small">{p.on_hand} in stock</div></td>
                <td style={{ width: 110 }}><input type="number" step="0.01" min="0" value={line(p).price} onChange={(e) => setLine(p, { price: e.target.value })} /></td>
                <td style={{ width: 90 }}><input type="number" min="0" step="1" placeholder="0" value={line(p).qty} onChange={(e) => setLine(p, { qty: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '12px 0', fontWeight: 600 }}>{bottles} bottle(s) · {rm(total)}</p>
    </FormModal>
  );
}
