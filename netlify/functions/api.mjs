// The portal's API on Netlify (portal.nelmoragroup.com/api/*).
//
// Netlify functions don't keep files between requests, so the database file (nelmora.db) lives in
// Netlify Blobs. For each request we load it into memory, run the normal portal code (server/app.js),
// and if anything changed we save it back. A copy of the database as it was at the start of each
// day is also kept (backups/YYYY-MM-DD.db), so a bad day can always be undone.
//
// This uses Netlify's current function format, which gives Blobs "strong consistency":
// a save is visible to the very next request.

import express from 'express';
import serverless from 'serverless-http';
import { getStore } from '@netlify/blobs';
import app from '../../server/app.js';
import dbModule from '../../server/db.js';
import mailModule from '../../server/mail.js';

process.env.TZ = 'Asia/Kuala_Lumpur'; // dates like "today" follow Malaysia time, same as on your computer

const { db, openFromBuffer, useDatabase, currentDatabase } = dbModule;
const KEY = 'nelmora.db';
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// If an environment can't do strong reads (e.g. the local `netlify dev` simulator), fall back to the
// default mode; the onlyIfMatch check below still stops one save from overwriting another.
let consistency = 'strong';
const STORE = process.env.BLOBS_STORE || 'nelmora'; // only changed for testing
const store = () => getStore({ name: STORE, consistency });
async function withStore(fn) {
  try {
    return await fn(store());
  } catch (e) {
    if (consistency !== 'strong' || e?.name !== 'BlobsConsistencyError') throw e;
    console.warn('Netlify Blobs: strong consistency not available here, using eventual consistency.');
    consistency = 'eventual';
    return fn(store());
  }
}
// Speed: keep the opened database in memory between requests ("warm"). Each request only asks Blobs
// whether it changed (sending our version tag); if not (304), nothing is downloaded or re-opened, and
// calc.js's saved results are reused too. Any change by anyone gives a new tag, so data is never stale.
let warm = null; // { etag, db }
function openCurrent() {
  return withStore(async (blobs) => {
    const got = await blobs.getWithMetadata(KEY, { type: 'arrayBuffer', ...(warm?.etag ? { etag: warm.etag } : {}) });
    if (got && got.data === null && warm && got.etag === warm.etag) { useDatabase(warm.db); return { blobs, etag: warm.etag }; }
    const d = openFromBuffer(got ? Buffer.from(got.data) : null);
    useDatabase(d);
    warm = { etag: got?.etag || null, db: d };
    return { blobs, etag: warm.etag };
  });
}
// After saving: remember the saved version so the next request can reuse it.
const keepWarm = (etag) => { warm = etag ? { etag, db: currentDatabase() } : null; };

// Run the Express portal for a web Request (via serverless-http's event format).
const outer = express();
outer.use((req, _res, next) => { req.url = req.url.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api'); next(); });
outer.use(app);
const run = serverless(outer, { binary: ['application/octet-stream'] });

async function runPortal(req, ip = "unknown") {
  const url = new URL(req.url);
  const headers = Object.fromEntries(req.headers);
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : Buffer.from(await req.arrayBuffer());
  const out = await run({
    httpMethod: req.method,
    path: url.pathname,
    headers,
    multiValueHeaders: {},
    queryStringParameters: url.search ? Object.fromEntries(url.searchParams) : null,
    multiValueQueryStringParameters: null,
    body: body ? body.toString('base64') : null,
    isBase64Encoded: !!body,
    requestContext: { identity: { sourceIp: ip } }, // the visitor's address, so per-device limits work
  }, {});
  const resHeaders = new Headers();
  for (const [k, v] of Object.entries(out.headers || {})) resHeaders.set(k, String(v));
  for (const [k, vs] of Object.entries(out.multiValueHeaders || {})) for (const v of vs) resHeaders.append(k, String(v));
  const resBody = out.body == null ? null : out.isBase64Encoded ? Buffer.from(out.body, 'base64') : out.body;
  return { status: out.statusCode, headers: resHeaders, body: resBody };
}

const clientIp = (req, context) => context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// ---------------------------------------------------------------- password-guess protection
// Kept in Blobs, so every copy of the function shares the count:
// 5 wrong tries from one device → that device waits 15 minutes;
// 30 wrong tries from anywhere within 15 minutes → login is paused for everyone for 15 minutes.
const GUARD_KEY = 'login-guard.json';
const LOCK_MS = 15 * 60 * 1000;
const PER_DEVICE = 5;
const ALL_DEVICES = 30;
const tooMany = (until) => json(429, { error: `Too many wrong attempts. Try again after ${new Date(until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` });

async function loginGuard(ip, attempt) {
  const now = Date.now();
  // If the guard can't be read, the error stops the sign-in (fail closed) rather than skipping the check.
  const { blobs, g: saved } = await withStore(async (b) => ({ blobs: b, g: await b.get(GUARD_KEY, { type: 'json' }) }));
  const g = saved || { ips: {}, all: { n: 0, since: now, until: 0 } };
  for (const [k, v] of Object.entries(g.ips)) if (v.until < now && now - (v.last || 0) > LOCK_MS) delete g.ips[k];
  if (now - g.all.since > LOCK_MS && g.all.until < now) g.all = { n: 0, since: now, until: 0 };
  const lockedUntil = Math.max(g.ips[ip]?.until || 0, g.all.until || 0);
  if (lockedUntil > now) return tooMany(lockedUntil);

  const res = await attempt();
  if (res.status === 401) {
    const d = g.ips[ip] || { n: 0, until: 0 };
    d.n += 1; d.last = now;
    if (d.n >= PER_DEVICE) { d.until = now + LOCK_MS; d.n = 0; }
    g.ips[ip] = d;
    g.all.n += 1;
    if (g.all.n >= ALL_DEVICES) { g.all.until = now + LOCK_MS; g.all.n = 0; g.all.since = now; }
    await blobs.setJSON(GUARD_KEY, g);
  } else if (res.status === 200 && g.ips[ip]) {
    delete g.ips[ip];
    await blobs.setJSON(GUARD_KEY, g);
  }
  return res;
}

export default async (req, context) => {
  mailModule.clearMail(); // nothing left over from an earlier request
  // Sign-in attempts go through the guard. The database is loaded (staff accounts live there) but never saved.
  if (req.method === 'POST' && /\/api\/login$/.test(new URL(req.url).pathname)) {
    const ip = clientIp(req, context);
    const opening = openCurrent(); // load the database while the guard is checked (in parallel)
    opening.catch(() => {});
    return loginGuard(ip, async () => {
      const { blobs, etag } = await opening;
      const res = await runPortal(req, ip);
      // A staff sign-in records "last sign-in" for the owner's Team page. Save it, but never let
      // a save problem block the sign-in itself (it is only an activity note).
      if (res.headers.get('x-db-changed')) {
        try {
          const w = res.status === 200 && etag ? await blobs.set(KEY, toArrayBuffer(db.serialize()), { onlyIfMatch: etag }) : null;
          keepWarm(w?.modified ? w.etag : null);
        } catch (e) { console.warn('last sign-in not saved:', e.message); keepWarm(null); }
      }
      res.headers.delete('x-db-changed');
      return new Response(res.body, { status: res.status, headers: res.headers });
    });
  }

  // 1. Load the database (reused from memory when unchanged; a new, empty one the very first time).
  const { blobs, etag } = await openCurrent();
  const isRead = req.method === 'GET' || req.method === 'HEAD';
  const original = !isRead && etag ? db.serialize() : null; // for the daily backup, before anything changes

  // 2. Run the portal.
  let res;
  try { res = await runPortal(req, clientIp(req, context)); } catch (e) { keepWarm(null); throw e; }
  const reply = () => new Response(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers: res.headers });

  // 3. Save changes. Reads (GET) don't change anything.
  if (isRead) { mailModule.clearMail(); return reply(); }
  if (res.status >= 400) { mailModule.clearMail(); keepWarm(null); return reply(); } // nothing saved: reload next time

  const today = new Date().toLocaleDateString('en-CA');
  if (original) await blobs.set(`backups/${today}.db`, toArrayBuffer(original), { onlyIfNew: true });

  const buf = db.serialize();
  const write = etag
    ? await blobs.set(KEY, toArrayBuffer(buf), { onlyIfMatch: etag })
    : await blobs.set(KEY, toArrayBuffer(buf), { onlyIfNew: true });

  // Someone else saved a change at the same moment: don't overwrite it.
  if (!write.modified) { mailModule.clearMail(); keepWarm(null); return json(409, { error: 'Someone else saved a change at the same time. Please refresh and try again.' }); }
  keepWarm(write.etag);
  await mailModule.flushMail(); // e.g. "new design job" emails, only now that the change is saved
  return reply();
};

// Serve the API at /api/* directly.
export const config = { path: '/api/*' };
