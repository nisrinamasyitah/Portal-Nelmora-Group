// The portal's API on Netlify (portal.nelmoragroup.com/api/*).
//
// Netlify functions don't keep files between requests, so the database file (nelmora.db) lives in
// Netlify Blobs. For each request we load it into memory, run the normal portal code (server/app.js),
// and if anything changed we save it back. A copy of the database as it was at the start of each
// day is also kept (backups/YYYY-MM-DD.db), so a bad day can always be undone.

process.env.TZ = 'Asia/Kuala_Lumpur'; // dates like "today" follow Malaysia time, same as on your computer

const express = require('express');
const serverless = require('serverless-http');
const { connectLambda, getStore } = require('@netlify/blobs');
const app = require('../../server/app');
const { db, openFromBuffer, useDatabase } = require('../../server/db');

const KEY = 'nelmora.db';
// "strong" = a save is visible to the very next request. If this environment can't do that
// (e.g. the local `netlify dev` simulator), fall back to the default mode; the onlyIfMatch check
// below still stops one save from overwriting another.
let consistency = 'strong';
const store = () => getStore({ name: 'nelmora', consistency });
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
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// Requests may arrive as /.netlify/functions/api/... ; the portal code expects /api/...
const outer = express();
outer.use((req, _res, next) => { req.url = req.url.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api'); next(); });
outer.use(app);
const run = serverless(outer, { binary: ['application/octet-stream'] });

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event, context) => {
  connectLambda(event);

  // 1. Load the database (a new, empty one the very first time).
  const { blobs, saved } = await load(store());
  const original = saved ? Buffer.from(saved.data) : null;
  useDatabase(openFromBuffer(original));

  // 2. Run the portal.
  const res = await run(event, context);

  // 3. Save changes. Reads (GET) and the login don't change anything.
  const method = (event.httpMethod || 'GET').toUpperCase();
  const isLogin = /\/login$/.test(event.path || '');
  if (method === 'GET' || method === 'HEAD' || isLogin || res.statusCode >= 400) return res;

  const today = new Date().toLocaleDateString('en-CA');
  if (original) await blobs.set(`backups/${today}.db`, toArrayBuffer(original), { onlyIfNew: true });

  const buf = db.serialize();
  const write = saved?.etag
    ? await blobs.set(KEY, toArrayBuffer(buf), { onlyIfMatch: saved.etag })
    : await blobs.set(KEY, toArrayBuffer(buf), { onlyIfNew: true });

  // Someone else saved a change at the same moment: don't overwrite it.
  if (!write.modified) return json(409, { error: 'Someone else saved a change at the same time. Please refresh and try again.' });
  return res;
};
