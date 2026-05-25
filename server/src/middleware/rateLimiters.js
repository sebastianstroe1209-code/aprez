// Tier K3 — rate limiters for auth endpoints.
//
// Pre-K3 a 12-attempt brute-force loop against /auth/login returned 401
// every time and never 429. Forgot-password was an unbounded email-spam
// vector (3 unconnected accounts × any number of POSTs).
//
// SPEC §15 / Tier K choices (pre-decided with Sebastian):
//   - Login: 5 failed attempts / 15 min per (IP, lowercased identifier).
//     We key on email/username so a single noisy IP behind a corporate
//     NAT doesn't lock out every diner; the IP is mixed in so an
//     attacker can't bypass by rotating the identifier.
//   - Forgot-password: 3 / hour per email + 10 / hour per IP. Two
//     limiters chained — either limit trips → 429. Per-email guards
//     against targeted spam at one address; per-IP catches a sweep
//     across many addresses from one origin.
//
// Response shape: structured 429 with `Retry-After` header (seconds).
//   { error: { code: 'rate-limited', message, retryAfterSec } }
//
// `skipSuccessfulRequests` is on for login so a legitimate user who
// gets their password right doesn't burn budget. Forgot-password
// counts every request (we can't tell what's "successful" — the
// response is always-200 neutral by design).
//
// Requires `app.set('trust proxy', N)` upstream so Render's
// X-Forwarded-For is honored — without it every request looks like
// it's from the Render edge IP and the per-IP key collapses to one.
//
// K3a (2026-05-25 fix-the-fix): keyGenerator now prefers the
// `cf-connecting-ip` header (Cloudflare-guaranteed, stripped from any
// spoofed inbound copy) over `req.ip`. The Cloudflare edge that hits
// our Render origin varies per CF POP routing decision — so even with
// `trust proxy` correctly set, basing the key on the upstream-derived
// IP can drift across requests from the SAME real client and never
// trip the limiter. cf-connecting-ip is the stable real-client signal.
// Off-CF (local dev, direct origin hits) the header is null and we
// fall back to req.ip.
//
// Also: in-memory store means the limiter is per-instance. Render's
// rolling deploys reset the bucket; horizontally-scaled deployments
// would multiply the effective limit by N_instances. The diag probe
// at /api/__diag/ip showed one stable instance at MVP — fine for now.
// For meaningful protection against distributed brute-force, set up
// Cloudflare Rate Limiting Rules at the edge.

const { rateLimit, MemoryStore } = require('express-rate-limit');

function clientIp(req) {
  // CF-Connecting-IP is stripped by Cloudflare from inbound requests
  // and re-added on its way to origin, so it can't be spoofed when CF
  // is upstream. req.ip is the fallback for non-CF paths (local dev,
  // smokes, direct origin hits).
  const cf = req.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf;
  return req.ip || 'unknown-ip';
}

// Explicit store instances so the dev-only reset endpoint can wipe
// them between smoke runs. The middleware itself doesn't expose its
// store, so we have to hold our own references.
const loginStore = new MemoryStore();
const fpIpStore = new MemoryStore();
const fpEmailStore = new MemoryStore();

function rateLimitedHandler(req, res, _next, opts) {
  const retryAfterSec = Math.ceil((opts.windowMs - (Date.now() - (req.rateLimit?.resetTime?.getTime?.() - opts.windowMs || 0))) / 1000) || Math.ceil(opts.windowMs / 1000);
  res.set('Retry-After', String(retryAfterSec));
  return res.status(429).json({
    error: {
      code: 'rate-limited',
      message: 'Too many requests. Please wait and try again.',
      retryAfterSec,
    },
  });
}

function ipPlusIdentifier(req) {
  // Pick whichever identifier this endpoint uses. Lowercase + trim to
  // normalize 'ME@x.com' and 'me@x.com' into the same bucket.
  const raw =
    req.body?.email ||
    req.body?.username ||
    req.body?.usernameOrEmail ||
    '';
  const id = String(raw).trim().toLowerCase();
  return `${clientIp(req)}|${id || 'anon'}`;
}

function ipKey(req) {
  return clientIp(req);
}

function emailKey(req) {
  // Diner endpoint sends `email`; staff endpoint sends `usernameOrEmail`.
  // Pick whichever is present so both wire to the same per-identifier
  // limiter shape.
  const raw = req.body?.email || req.body?.usernameOrEmail || '';
  return String(raw).trim().toLowerCase() || 'no-email';
}

// 5 / 15 min per (IP, identifier).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: ipPlusIdentifier,
  handler: rateLimitedHandler,
  store: loginStore,
});

// 10 / hour per IP. Combined with the per-email limiter below.
const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: ipKey,
  handler: rateLimitedHandler,
  store: fpIpStore,
});

// 3 / hour per lowercased email.
const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: emailKey,
  handler: rateLimitedHandler,
  store: fpEmailStore,
});

// Dev/test only — wipe the in-memory store so smokes are deterministic
// across runs. Production code paths never call this (the dev-only
// route in index.js guards on NODE_ENV !== 'production'). Awaits each
// store's resetAll() to ensure the counter is cleared before the next
// request lands.
async function resetAllLimitersForTests() {
  await Promise.all([
    loginStore.resetAll(),
    fpIpStore.resetAll(),
    fpEmailStore.resetAll(),
  ]);
}

module.exports = {
  loginLimiter,
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  resetAllLimitersForTests,
};
