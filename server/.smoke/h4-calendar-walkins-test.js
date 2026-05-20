// Tier H commit 4 — Calendar walk-in endpoint smoke (SPEC §6.4).
//
// GET /api/restaurant/walk-ins?date=YYYY-MM-DD feeds the Calendar's
// past+future planning view: it returns walk-in TableActivity rows for a
// PAST date and [] for today / future (today is the Live floor plan's
// domain; future has no walk-ins).
//
//   [a] yesterday → 200, array; the two seeded WALK_IN rows appear with
//       the documented shape, walkInName resolved from TableActivity.notes
//       (a real name for the named row, null for the anonymous one).
//   [b] today    → 200, [] (past-only — today belongs to Live).
//   [c] tomorrow → 200, [] (future has no walk-ins).
//
// Requires the backend on :4000. Seeds + tears down two `[smoke-h4]`
// WALK_IN rows on the lamama staff's restaurant, dated yesterday,
// keyed by a distinctive partySize so a crashed prior run is cleaned.

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const SMOKE_PARTY_NAMED = 17;
const SMOKE_PARTY_ANON = 18;

// Bucharest calendar date, offset by `days`, as YYYY-MM-DD.
function bucharestDate(days) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function http(method, path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}

async function wipe(restaurantId, ymd) {
  await prisma.tableActivity.deleteMany({
    where: {
      restaurantId,
      kind: 'WALK_IN',
      date: new Date(`${ymd}T00:00:00.000Z`),
      partySize: { in: [SMOKE_PARTY_NAMED, SMOKE_PARTY_ANON] },
    },
  });
}

async function main() {
  const yesterday = bucharestDate(-1);
  const today = bucharestDate(0);
  const tomorrow = bucharestDate(1);

  const login = await http('POST', '/auth/restaurant/login', null, {
    username: 'lamama', password: 'lamama123',
  });
  const token = login.body?.token;
  const restaurantId = login.body?.staff?.restaurantId;
  expect(!!token, 'lamama login → token');
  expect(!!restaurantId, `login → restaurantId (${restaurantId})`);

  const table = await prisma.restaurantTable.findFirst({
    where: { restaurantId, isActive: true },
    select: { id: true },
  });
  expect(!!table, 'found an active table on the restaurant');

  console.log(`\n[baseline] wipe leftover [smoke-h4] walk-ins on ${yesterday}`);
  await wipe(restaurantId, yesterday);

  console.log('[seed] one named + one anonymous WALK_IN dated yesterday');
  const named = await prisma.tableActivity.create({
    data: {
      tableId: table.id, restaurantId, kind: 'WALK_IN',
      date: new Date(`${yesterday}T00:00:00.000Z`),
      startedAt: new Date(`${yesterday}T19:00:00.000Z`),
      endedAt: new Date(`${yesterday}T21:00:00.000Z`),
      partySize: SMOKE_PARTY_NAMED,
      notes: '[smoke-h4] Popescu',
    },
  });
  const anon = await prisma.tableActivity.create({
    data: {
      tableId: table.id, restaurantId, kind: 'WALK_IN',
      date: new Date(`${yesterday}T00:00:00.000Z`),
      startedAt: new Date(`${yesterday}T13:00:00.000Z`),
      endedAt: new Date(`${yesterday}T14:30:00.000Z`),
      partySize: SMOKE_PARTY_ANON,
      notes: null,
    },
  });

  console.log('\n[a] GET /walk-ins?date=<yesterday> — past date returns the rows');
  const y = await http('GET', `/restaurant/walk-ins?date=${yesterday}`, token);
  expect(y.status === 200, `status=200 (got ${y.status})`);
  expect(Array.isArray(y.body), 'body is an array');
  const namedRow = (y.body || []).find((w) => w.id === named.id);
  const anonRow = (y.body || []).find((w) => w.id === anon.id);
  expect(!!namedRow, 'seeded NAMED walk-in present in the response');
  expect(!!anonRow, 'seeded ANON walk-in present in the response');
  expect(namedRow?.tableId === table.id, 'row carries tableId');
  expect(namedRow?.partySize === SMOKE_PARTY_NAMED, `row carries partySize (${namedRow?.partySize})`);
  expect(!!namedRow?.startedAt && !!namedRow?.endedAt, 'row carries startedAt + endedAt');
  expect(namedRow?.walkInName === '[smoke-h4] Popescu', `named row walkInName from notes (got ${JSON.stringify(namedRow?.walkInName)})`);
  expect(anonRow?.walkInName === null, `anon row walkInName is null (got ${JSON.stringify(anonRow?.walkInName)})`);

  console.log('\n[b] GET /walk-ins?date=<today> — today is Live’s domain → []');
  const t = await http('GET', `/restaurant/walk-ins?date=${today}`, token);
  expect(t.status === 200, `status=200 (got ${t.status})`);
  expect(Array.isArray(t.body) && t.body.length === 0, `today returns [] (got ${JSON.stringify(t.body)?.slice(0, 60)})`);

  console.log('\n[c] GET /walk-ins?date=<tomorrow> — future has no walk-ins → []');
  const tm = await http('GET', `/restaurant/walk-ins?date=${tomorrow}`, token);
  expect(tm.status === 200, `status=200 (got ${tm.status})`);
  expect(Array.isArray(tm.body) && tm.body.length === 0, `tomorrow returns [] (got ${JSON.stringify(tm.body)?.slice(0, 60)})`);

  console.log('\n[cleanup]');
  await wipe(restaurantId, yesterday);

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SMOKE ERROR', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
