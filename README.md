# Nelmora Portal

Your business in one place: **cash flow, stock, event costing, monthly sales, agents and reports.**

- Frontend: React (Vite)
- Backend: Node + Express
- Database: SQLite (one file, `data/nelmora.db`, nothing to install or configure)

## Set up (5 minutes)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cd nelmora-portal
npm run setup        # installs everything (once)
npm run build        # builds the website (once, and after code changes)
npm start            # runs the portal
```

Open **http://localhost:3001**.

Want to see it with sample data first? Run `npm run seed:demo` before `npm start`.
To wipe it and start clean: stop the server and delete the `data/` folder.

### While editing the code
`npm run dev` runs the API and the website with live reload. Open **http://localhost:5173**.

## First 10 minutes

1. **Settings**: enter your opening cash, default daily wage and commission, and agent tiers.
2. **Stock**: rename the placeholder scents to your 11 real ones (and the 30ml). Then **+ Add stock** for what you already own. Untick *Paid with cash now* for opening/carried-forward bottles so they don't show as money spent.
3. **Events**: create an event, then add its costs (booth fee, transport…).
4. After each booth day, open the event and click **Record sales** (type the count per scent).
5. Check **Dashboard**, **Cash flow** and **Monthly report**.

## What each page does

| Page | What it's for |
|---|---|
| Dashboard | Cash balance, this month's sales and profit, stock value, low stock, top sellers, events |
| Cash flow | Every money-in/out with a running balance. Sales, stock purchases, event costs, wages and agent commission are added **automatically**. You only add the extras (capital, marketing, tools, withdrawals) |
| Stock | Bottles on hand, average cost, margin, value. Add production batches, write off testers/damaged bottles |
| Events | Per-event costing: sales, cost of bottles sold, wages, commission, booth costs, net profit, break-even bottles |
| Sales | All sales by month and channel (booth, agent, online, other) |
| Agents | Agent list, commission earned, tier table |
| Monthly report | Profit & loss and cash for each month, with CSV export |
| Settings | Defaults, commission tiers, backup download |

## How the numbers are worked out

- **Stock cost** uses a *moving average*: leftover bottles blend with new batches. Unsold stock is an asset, never a loss, so nothing is charged twice.
- **Event net profit** = sales − cost of bottles sold − wages (worker-days × daily wage) − booth commission (per bottle) − booth costs.
- **Agent commission** is per bottle by tier, using the agent's total bottles on the same date. Orders under the lowest tier earn nothing.
- **Cash flow vs profit**: buying stock is cash out immediately but only becomes a cost when sold, so the two differ. Capital injections and owner withdrawals count in cash, not in profit.
- Entries dated in the future (e.g. wages of an event that hasn't ended) show as *upcoming* and count once their date arrives.
- Each event keeps its own wage and commission rate, so changing the defaults later doesn't rewrite old events.

## Keeping it safe

- **Back up**: Settings → *Download backup* (or copy `data/nelmora.db`; the server writes everything into that file at start-up and every 5 minutes). Do it weekly.
- **Local only by default**: the server only accepts connections from your own computer.
- **To use it from your phone or put it online**: copy `.env.example` to `.env`, set `PORTAL_PASSWORD` and `SESSION_SECRET` (and optionally `PORTAL_EMAIL` to require an email too), and set `HOST=0.0.0.0` for same-Wi-Fi access. If you host it on the internet, put it behind HTTPS (for example Render, Railway or a VPS with Caddy) and keep the `data/` folder on a persistent disk.

## Project layout

```
server/index.js      API routes + optional login
server/calc.js       all the costing / cash / monthly maths (start here to check a number)
server/db.js         database tables and defaults
server/seed-demo.js  optional sample data
client/src/pages/    one file per screen
```
