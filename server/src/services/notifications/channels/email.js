// Email channel — Resend integration lands in C2. Email is not in the §10
// per-event matrix; it is reserved for transactional flows such as the
// admin-issued staff credentials handoff and forgot-password reset (Tier D).
// Kept here so the dispatcher exposes a uniform 4-channel surface.

async function sendEmail(_prisma, _io, { to, subject, html, text }) {
  if (!to) return null;
  console.log(`[email:stub] to=${to} subject="${subject}"`);
  if (text) console.log(`[email:stub] text="${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"`);
  // C2 will replace this with a Resend API call using RESEND_API_KEY.
  return { stub: true, to, subject };
}

module.exports = { sendEmail };
