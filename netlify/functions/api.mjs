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

process.env.TZ = 'Asia/Kuala_Lumpur'; // dates like "today" follow Malaysia time, same as on your computer

const { db, openFromBuffer, useDatabase } = dbModule;
const KEY = 'nelmora.db';
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// If an environment can't do strong reads (e.g. the local `netlify dev` simulator), fall back to the
// default mode; the onlyIfMatch check below still stops one save from overwriting another.
let consistency = 'strong';
const STORE = process.env.BLOBS_STORE || 'nelmora'; // only changed for testing
const store = () => getStore({ name: STORE, consistency });
async function load(blobs) {
  try {
    return { blobs, saved: await blobs.getWithMetadata(KEY, { type: 'arrayBuffer' }) };
  } catch (e) {
    if (consistency !== 'strong' || e?.name !== 'BlobsConsistencyError') throw e;
    console.warn('Netlify Blobs: strong consistency not available here, using eventual consistency.');
    consistency = 'eventual';
    const again = store();
    return { blobs: again, saved: await again.getWithMetadata(KEY, { type: 'arrayBuffer' }) };
  }
}

// Run the Express portal for a web Request (via serverless-http's event format).
const outer = express();
outer.use((req, _res, next) => { req.url = req.url.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api'); next(); });
outer.use(app);
const run = serverless(outer, { binary: ['application/octet-stream'] });

async function runPortal(req) {
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
    requestContext: {},
  }, {});
  const resHeaders = new Headers();
  for (const [k, v] of Object.entries(out.headers || {})) resHeaders.set(k, String(v));
  for (const [k, vs] of Object.entries(out.multiValueHeaders || {})) for (const v of vs) resHeaders.append(k, String(v));
  const resBody = out.body == null ? null : out.isBase64Encoded ? Buffer.from(out.body, 'base64') : out.body;
  return { status: out.statusCode, headers: resHeaders, body: resBody };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  // 1. Load the database (a new, empty one the very first time).
  const { blobs, saved } = await load(store());
  const original = saved ? Buffer.from(saved.data) : null;
  useDatabase(openFromBuffer(original));

  // 2. Run the portal.
  const res = await runPortal(req);
  const reply = () => new Response(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers: res.headers });

  // 3. Save changes. Reads (GET) and the login don't change anything.
  const isLogin = /\/login$/.test(new URL(req.url).pathname);
  if (req.method === 'GET' || req.method === 'HEAD' || isLogin || res.status >= 400) return reply();

  const today = new Date().toLocaleDateString('en-CA');
  if (original) await blobs.set(`backups/${today}.db`, toArrayBuffer(original), { onlyIfNew: true });

  const buf = db.serialize();
  const write = saved?.etag
    ? await blobs.set(KEY, toArrayBuffer(buf), { onlyIfMatch: saved.etag })
    : await blobs.set(KEY, toArrayBuffer(buf), { onlyIfNew: true });

  // Someone else saved a change at the same moment: don't overwrite it.
  if (!write.modified) return json(409, { error: 'Someone else saved a change at the same time. Please refresh and try again.' });
  return reply();
};

// Serve the API at /api/* directly.
export const config = { path: '/api/*' };
