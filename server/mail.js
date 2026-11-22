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
  for (const { fromName, ...m } of msgs) {
    // fromName: show who it's from (e.g. "Amira via Nelmora Portal"); it is still sent by the portal's own account.
    const sender = fromName ? `"${fromName.replace(/"/g, '')}" <${process.env.SMTP_USER}>` : from;
    try { await transport.sendMail({ from: sender, ...m }); results.push({ to: m.to, ok: true }); }
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

const STATUS = { todo: 'To do', doing: 'In progress', done: 'Done' };

// Email to the owner when a designer updates a job (status, file link or note). Reply goes to the designer.
function staffUpdateMail({ to, staffName, replyTo, design, before, changes }) {
  const link = `${portalUrl()}/designs`;
  const status = STATUS[design.status] || design.status;
  const headline = changes.includes('status')
    ? (design.status === 'done' ? `${staffName} finished a design` : design.status === 'doing' ? `${staffName} started a design` : `${staffName} moved a design back to To do`)
    : changes.includes('file') ? `${staffName} added the file link` : `${staffName} left you a note`;
  const subject = changes.includes('status')
    ? `${staffName}: ${design.title} is now ${status}`
    : changes.includes('file') ? `${staffName}: file link added for ${design.title}` : `${staffName}: note on ${design.title}`;
  const rows = [
    ['Job', design.title],
    design.event_name && ['For event', design.event_name],
    ['Status', changes.includes('status') ? `${STATUS[before.status] || before.status} → ${status}` : status],
    ['Fee', 'RM ' + Number(design.fee || 0).toFixed(2)],
    design.file_link && ['File', design.file_link],
  ].filter(Boolean);
  const text = [
    `${headline}.`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(design.staff_note ? ['', `Note from ${staffName}:`, design.staff_note] : []),
    ...(design.status === 'done' ? ['', 'When you have paid her, click Pay on the Designs page.'] : []),
    '', `Open in the portal: ${link}`, '', `Reply to this email to answer ${staffName}.`,
  ].join('\n');
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f2ef;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #ece3df">
      <div style="background:#4f0f20;color:#fff;padding:22px 24px">
        <div style="font-size:12px;letter-spacing:.18em;font-weight:bold;opacity:.8">NELMORA</div>
        <div style="font-size:20px;font-weight:bold;margin-top:6px">${esc(headline)}</div>
      </div>
      <div style="padding:22px 24px;color:#2b1a1e;font-size:14px;line-height:1.5">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#8a777b;width:110px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:bold;word-break:break-all">${k === 'File' ? `<a href="${esc(v)}" style="color:#6b1a2e">${esc(v)}</a>` : esc(v)}</td></tr>`).join('')}
        </table>
        ${design.staff_note ? `<div style="background:#faf4f5;border-radius:10px;padding:12px 14px;margin-top:14px;white-space:pre-wrap"><b>Note from ${esc(staffName)}</b><br>${esc(design.staff_note)}</div>` : ''}
        ${design.status === 'done' ? `<p style="margin:14px 0 0">When you have paid her, click <b>Pay</b> on the Designs page.</p>` : ''}
        <p style="margin:22px 0 6px"><a href="${esc(link)}" style="background:#6b1a2e;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;display:inline-block;font-weight:bold">Open Designs</a></p>
        <p style="color:#8a777b;font-size:12px;margin-top:18px">Reply to this email to answer ${esc(staffName)} directly.</p>
      </div>
    </div>
  </div>`;
  return { to, subject, text, html, replyTo, fromName: `${staffName} via Nelmora Portal` };
}

module.exports = { queueMail, clearMail, flushMail, configured, newJobMail, staffUpdateMail };
