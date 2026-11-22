// Email notifications (e.g. "new design job" to the designer).
//
// Set these in .env (computer) or Netlify → Environment variables:
//   SMTP_HOST   e.g. smtp.gmail.com
//   SMTP_PORT   465 (SSL) or 587
//   SMTP_USER   the sending account, e.g. yourname@gmail.com
//   SMTP_PASS   for Gmail: an App Password (Google Account → Security → App passwords), not your normal password
//   MAIL_FROM   optional, e.g. "Nelmora Portal <yourname@gmail.com>" (defaults to SMTP_USER)
//   PORTAL_URL  optional, link used in emails (default https://portal.nelmoragroup.com)
//
// Emails are queued while a request runs and only sent after its changes are saved
// (so nobody is told about a job that didn't save). Without SMTP settings nothing is sent.

const nodemailer = require('nodemailer');

const outbox = [];
const configured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const portalUrl = () => (process.env.PORTAL_URL || 'https://portal.nelmoragroup.com').replace(/\/$/, '');

function queueMail(msg) { outbox.push(msg); }
function clearMail() { outbox.length = 0; }

async function flushMail() {
  const msgs = outbox.splice(0);
  if (!msgs.length || !configured()) return [];
  const port = Number(process.env.SMTP_PORT) || 465;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = process.env.MAIL_FROM || `Nelmora Portal <${process.env.SMTP_USER}>`;
  const results = [];
  for (const m of msgs) {
    try { await transport.sendMail({ from, ...m }); results.push({ to: m.to, ok: true }); }
    catch (e) { console.error('Email to', m.to, 'failed:', e.message); results.push({ to: m.to, ok: false, error: e.message }); }
  }
  return results;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date');

// "Nelmora: New design job for Amira" email for a design job.
function newJobMail({ to, name, design }) {
  const link = `${portalUrl()}/designs`;
  const rows = [
    ['Job', design.title],
    design.event_name && ['For event', design.event_name],
    ['Due', fmtDate(design.due_date)],
    ['Your fee', 'RM ' + Number(design.fee || 0).toFixed(2)],
  ].filter(Boolean);
  const text = [
    `Hi ${name},`, '', 'You have a new design job from Nelmora.', '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(design.brief ? ['', 'Brief:', design.brief] : []),
    '', `Open it in the portal: ${link}`, '', '— Nelmora Portal',
  ].join('\n');
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ef;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #ece3df">
      <div style="background:#4f0f20;color:#fff;padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.18em;font-weight:bold;opacity:.8">NELMORA</div>
        <div style="font-size:20px;font-weight:bold;margin-top:6px">New design job for you</div>
      </div>
      <div style="padding:22px 24px;color:#2b1a1e;font-size:14px;line-height:1.5">
        <p style="margin:0 0 14px">Hi ${esc(name)},</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#8a777b;width:110px">${esc(k)}</td><td style="padding:6px 0;font-weight:bold">${esc(v)}</td></tr>`).join('')}
        </table>
        ${design.brief ? `<div style="background:#faf4f5;border-radius:10px;padding:12px 14px;margin-top:14px;white-space:pre-wrap"><b>Brief</b><br>${esc(design.brief)}</div>` : ''}
        <p style="margin:22px 0 6px"><a href="${esc(link)}" style="background:#6b1a2e;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;display:inline-block;font-weight:bold">Open in Nelmora Portal</a></p>
        <p style="color:#8a777b;font-size:12px;margin-top:18px">Sign in with your Nelmora account to update the status and add your Canva link.</p>
      </div>
    </div>
  </div>`;
  return { to, subject: `Nelmora: New design job for ${name}`, text, html };
}

module.exports = { queueMail, clearMail, flushMail, configured, newJobMail };
