import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api, hasToken, setToken } from './api.js';
import { useApi } from './components.jsx';
// Pages load only when opened (smaller first download; the charts library is only fetched for
// Dashboard, Cash flow and Reports).
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const CashFlow = lazy(() => import('./pages/CashFlow.jsx'));
const Stock = lazy(() => import('./pages/Stock.jsx'));
const PerfumeCost = lazy(() => import('./pages/PerfumeCost.jsx'));
const Events = lazy(() => import('./pages/Events.jsx'));
const EventDetail = lazy(() => import('./pages/EventDetail.jsx'));
const Sales = lazy(() => import('./pages/Sales.jsx'));
const Agents = lazy(() => import('./pages/Agents.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Designs = lazy(() => import('./pages/Designs.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const Costing = lazy(() => import('./pages/Costing.jsx'));
const CostingSheet = lazy(() => import('./pages/Costing.jsx').then((m) => ({ default: m.CostingSheet })));
const staff = () => import('./pages/StaffPortal.jsx');
const StaffDashboard = lazy(() => staff().then((m) => ({ default: m.StaffDashboard })));
const MyDesigns = lazy(() => staff().then((m) => ({ default: m.MyDesigns })));
const StaffStock = lazy(() => staff().then((m) => ({ default: m.StaffStock })));
const StaffEvents = lazy(() => staff().then((m) => ({ default: m.StaffEvents })));
const MyAccount = lazy(() => staff().then((m) => ({ default: m.MyAccount })));

const PageLoading = () => <p className="muted page-loading">Loading…</p>;

function Login({ onDone, askEmail, notice }) {
  const [email, setEmail] = useState(() => localStorage.getItem('nelmora_email') || '');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { token } = await api('/login', { method: 'POST', body: { email, password: pw } });
      setToken(token);
      if (askEmail) localStorage.setItem('nelmora_email', email.trim());
      onDone();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <section className="login-hero">
        <div className="brand"><b>NELMORA</b><span>Business portal</span></div>
        <div className="login-quote">
          <h2>Sales, stock and cash flow for the Nelmora team.</h2>
          <p>Track events, agents and monthly profit in one portal.</p>
        </div>
        <div className="login-legal">© {new Date().getFullYear()} Nelmora. All rights reserved.</div>
      </section>
      <section className="login-panel">
        <form className="box" onSubmit={submit}>
          <div className="brand mobile-only"><b>NELMORA</b><span>Business portal</span></div>
          <h1>Sign in</h1>
          <p className="muted login-sub">Use your Nelmora account email and password.</p>
          {notice && !err && <div className="notice">{notice}</div>}
          {err && <div className="error">{err}</div>}
          {askEmail && (
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" autoComplete="username" placeholder="you@nelmora.com.my"
                value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pw">Password</label>
            <div className="pw-wrap">
              <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus={!askEmail || !!email} />
              <button type="button" className="link" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <button className="primary login-btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="muted small login-note">For authorised Nelmora staff only.</p>
        </form>
      </section>
    </div>
  );
}

// Line icons (24×24, stroke = currentColor)
const ICONS = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 9h8V3h-8z',
  cash: 'M2 7h20v10H2zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 12h.01M18 12h.01',
  report: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 17v-3M12 17v-6M15 17v-2',
  stock: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  events: 'M4 5h16v16H4zM4 10h16M8 3v4M16 3v4',
  cost: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  sales: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  agents: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  design: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.59 7.59M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  sheet: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
};

const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

const NAV = [
  ['Overview', [
    ['/', 'Dashboard', 'dashboard'],
    ['/cashflow', 'Cash flow', 'cash'],
    ['/reports', 'Monthly report', 'report'],
  ]],
  ['Operations', [
    ['/stock', 'Stock', 'stock'],
    ['/costing', 'Costing', 'sheet'],
    ['/perfume-cost', 'Perfume cost', 'cost'],
    ['/events', 'Events', 'events'],
    ['/sales', 'Sales', 'sales'],
    ['/agents', 'Agents', 'agents'],
    ['/designs', 'Designs', 'design'],
  ]],
  ['Account', [
    ['/team', 'Team & access', 'user'],
    ['/settings', 'Settings', 'settings'],
  ]],
];

// Staff (designer) menu: no cash flow, sales, costs or profit anywhere.
const STAFF_NAV = [
  ['My work', [
    ['/', 'My dashboard', 'dashboard'],
    ['/designs', 'My designs', 'design'],
  ]],
  ['Nelmora', [
    ['/stock', 'Stock', 'stock'],
    ['/events', 'Events', 'events'],
  ]],
  ['Account', [
    ['/account', 'My account', 'user'],
  ]],
];

function StaffShell({ me, onLogout }) {
  return (
    <div className="app">
      <Sidebar nav={STAFF_NAV} who={me.name} onLogout={onLogout} sub="Design studio" />
      <main className="main">
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<StaffDashboard me={me} />} />
          <Route path="/designs" element={<MyDesigns />} />
          <Route path="/stock" element={<StaffStock />} />
          <Route path="/events" element={<StaffEvents />} />
          <Route path="/account" element={<MyAccount me={me} onLogout={onLogout} />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function Sidebar({ nav, who, onLogout, sub = 'Business portal' }) {
  return (
    <aside className="side">
      <div className="brand"><b>NELMORA</b><span>{sub}</span></div>
      {nav.map(([section, items]) => (
        <div key={section} style={{ display: 'contents' }}>
          <div className="section">{section}</div>
          {items.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'nav' + (isActive ? ' active' : '')}>
              <Icon name={icon} />{label}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="spacer" />
      <div className="foot">
        <span className="who">{who}</span>
        {onLogout && <button onClick={onLogout}>Log out</button>}
      </div>
    </aside>
  );
}

function Shell({ onLogout, who, me }) {
  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><b>NELMORA</b><span>Business portal</span></div>
        {NAV.map(([section, items]) => (
          <div key={section} style={{ display: 'contents' }}>
            <div className="section">{section}</div>
            {items.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'nav' + (isActive ? ' active' : '')}>
                <Icon name={icon} />{label}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="spacer" />
        <div className="foot">
          <span className="who">{who || `© ${new Date().getFullYear()} Nelmora`}</span>
          {onLogout && <button onClick={onLogout}>Log out</button>}
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cashflow" element={<CashFlow />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/perfume-cost" element={<PerfumeCost />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/designs" element={<Designs />} />
          <Route path="/team" element={<Team me={me} />} />
          <Route path="/costing" element={<Costing />} />
          <Route path="/costing/:id" element={<CostingSheet />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings onLogout={onLogout} />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}

// Auto logout after 5 minutes with no mouse, keyboard, scroll or touch activity.
// Last activity is kept in localStorage so all open tabs share it, and a reopened tab after 5+ minutes starts logged out.
const IDLE_MS = 5 * 60 * 1000;
const ACTIVITY_KEY = 'nelmora_last_activity';
const readActivity = () => { try { return Number(localStorage.getItem(ACTIVITY_KEY)) || 0; } catch { return 0; } };
const markActivity = () => { try { localStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch { /* storage blocked */ } };

function useIdleLogout(active, onIdle) {
  useEffect(() => {
    if (!active) return undefined;
    if (Date.now() - readActivity() > IDLE_MS && readActivity()) { onIdle(); return undefined; }
    markActivity();
    let last = 0;
    const onAct = () => { const now = Date.now(); if (now - last > 5000) { last = now; markActivity(); } };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    const timer = setInterval(() => { if (Date.now() - readActivity() > IDLE_MS) onIdle(); }, 10000);
    // While someone is using the portal (activity in the last minute), check in with the server so the
    // login stays valid there too. When nobody is active, the server's login also expires (6 minutes).
    const keepAlive = setInterval(() => { if (Date.now() - readActivity() < 60000) api('/ping').catch(() => {}); }, 60000);
    return () => { events.forEach((e) => window.removeEventListener(e, onAct)); clearInterval(timer); clearInterval(keepAlive); };
  }, [active, onIdle]);
}

export default function App() {
  const auth = useApi('/auth-required');
  const [loggedIn, setLoggedIn] = useState(hasToken());
  const [idleOut, setIdleOut] = useState(false);
  const required = !!auth.data?.required;
  const onIdle = useCallback(() => { setToken(''); setLoggedIn(false); setIdleOut(true); }, []);
  useIdleLogout(required && loggedIn, onIdle);

  useEffect(() => {
    const onUnauth = () => { setToken(''); setLoggedIn(false); };
    window.addEventListener('nelmora-unauth', onUnauth);
    return () => window.removeEventListener('nelmora-unauth', onUnauth);
  }, []);

  // Who is signed in: the owner sees everything; staff get their own portal.
  const [me, setMe] = useState(null);
  const signedIn = !!auth.data && (!auth.data.required || loggedIn);
  useEffect(() => {
    if (!signedIn) { setMe(null); return; }
    api('/me').then(setMe).catch(() => setMe(null));
  }, [signedIn]);

  if (auth.loading && !auth.data) return <p className="muted" style={{ padding: 20 }}>Loading…</p>;
  if (auth.error) return <div className="error" style={{ margin: 20 }}>Cannot reach the server: {auth.error}. Is it running? (npm run dev)</div>;
  if (auth.data?.required && !loggedIn) return <Login askEmail={auth.data.email} notice={idleOut ? 'You were logged out after 5 minutes of no activity.' : ''} onDone={() => { markActivity(); setIdleOut(false); setLoggedIn(true); }} />;
  if (!me) return <p className="muted" style={{ padding: 20 }}>Loading…</p>;
  const logout = auth.data?.required ? () => { setToken(''); setLoggedIn(false); } : null;
  if (me.role !== 'owner') return <StaffShell me={me} onLogout={logout} />;
  return <Shell onLogout={logout} who={me.name} me={me} />;
}
