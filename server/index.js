// Runs the portal on your computer: npm start (or npm run dev). Netlify uses netlify/functions/api.mjs instead.
const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env is optional */ }

const app = require('./app');
const { dbPath } = require('./db');
app.locals.sendMailAfterResponse = true;

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Nelmora portal API on http://${HOST}:${PORT}  (database: ${dbPath})`);
  if (!app.locals.passwordSet) console.log('No PORTAL_PASSWORD set: login is off (fine for local use only).');
});
