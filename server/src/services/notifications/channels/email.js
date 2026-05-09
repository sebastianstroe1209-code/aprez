// Email channel — Resend transport. Email is not in SPEC §10's per-event
// matrix; it is reserved for transactional flows such as the admin-issued
// staff credentials handoff and forgot-password reset (Tier D). Kept here
// so the dispatcher exposes a uniform 4-channel surface.

const { Resend } = require('resend');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || null;
const FROM_NAME = process.env.RESEND_FROM_NAME || null;
const API_KEY = process.env.RESEND_API_KEY || null;

let cachedClient = null;
let warnedAboutMissingKey = false;

function getClient() {
  if (!API_KEY) {
    if (!warnedAboutMissingKey) {
      console.warn('[email] RESEND_API_KEY is not set — email channel will fall back to console.log. Set it in server/.env to send real mail.');
      warnedAboutMissingKey = true;
    }
    return null;
  }
  if (!cachedClient) cachedClient = new Resend(API_KEY);
  return cachedClient;
}

function defaultFrom() {
  if (!FROM_EMAIL) return null;
  return FROM_NAME ? `${FROM_NAME} <${FROM_EMAIL}>` : FROM_EMAIL;
}

async function sendEmail(_prisma, _io, { to, subject, html, text, from }) {
  if (!to) return null;

  const client = getClient();
  if (!client) {
    // Fallback: log what we would have sent so dev environments without keys
    // don't crash and the dispatcher can complete its other channels normally.
    console.log(`[email:fallback] to=${to} subject="${subject}"`);
    if (text) console.log(`[email:fallback] text="${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"`);
    return { fallback: true, to, subject };
  }

  const fromAddress = from || defaultFrom();
  if (!fromAddress) {
    console.error('[email] no from address — set RESEND_FROM_EMAIL in server/.env or pass `from` per-call. Skipping send.');
    return { error: 'no-from-address', to, subject };
  }

  try {
    const payload = {
      from: fromAddress,
      to: Array.isArray(to) ? to : [to],
      subject: subject || '',
    };
    if (html) payload.html = html;
    if (text) payload.text = text;
    if (!html && !text) payload.text = '';

    const { data, error } = await client.emails.send(payload);
    if (error) {
      // Resend SDK returns error object on API-level failures (rate limits,
      // invalid recipient, sandbox restrictions). Log and continue — the
      // calling dispatcher must not be blocked by an email failure.
      console.error(`[email] Resend error for to=${to} subject="${subject}": ${error.message || JSON.stringify(error)}`);
      return { error: error.message || String(error), to, subject };
    }
    console.log(`[email:sent] id=${data && data.id} to=${to} subject="${subject}"`);
    return { id: data && data.id, to, subject };
  } catch (err) {
    // Network or SDK exception. Same policy: log and continue.
    console.error(`[email] send failed for to=${to} subject="${subject}": ${err.message}`);
    return { error: err.message, to, subject };
  }
}

module.exports = { sendEmail };
