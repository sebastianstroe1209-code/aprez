// Tier G commit 5b — GET /restaurants party/date/time availability
// filter (SPEC §5.1).
//
// Exercises the new all-or-none availability join against a throwaway
// set of `[smoke-g5b]` restaurants, each engineered so exactly one
// trait decides whether it survives the filter:
//
//   R-EXACT    open, one free 4-seat table              → INCLUDED (single table fits)
//   R-MERGE    open, two adjacent free 2-seat tables    → INCLUDED (2+2 merge), party 5 → EXCLUDED
//   R-BUSY     open, sole 4-seat table booked at 19:00  → EXCLUDED (no free table, no merge)
//   R-NOSP     open 10–23 but service period 12–15 only → EXCLUDED (19:00 outside service period)
//   R-DISABLED open, free table, date marked disabled   → EXCLUDED (disabled date)
//   R-CLOSED   all opening hours isOpen=false           → EXCLUDED (closed)
//
// Plus: all-or-none semantics (missing any param → unfiltered baseline),
// the four structured 400 codes, and composition with cuisine + lat/lng.
//
// Requires the backend running on :4000. Seeds + tears down restaurants
// tagged `nameRo === '[smoke-g5b]'` (cascade drops sections/tables/
// hours/service-periods/disabled-dates; reservations + notifications +
// table-moves are deleted first since their FK is RESTRICT).

const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();
const TAG = '[smoke-g5b]';

function isoDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
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

// GET /restaurants with an arbitrary query param object.
function listRestaurants(token, params) {
  const qs = new URLSearchParams(params || {}).toString();
  return http('GET', `/restaurants${qs ? `?${qs}` : ''}`, token);
}

let passed = 0, failed = 0;
function expect(cond, label) {
  if (cond) { console.log(`  PASS — ${label}`); passed++; }
  else { console.error(`  FAIL — ${label}`); failed++; process.exitCode = 1; }
}
const has = (list, id) => Array.isArray(list) && list.some((r) => r.id === id);

async function wipeFixture() {
  const olds = await prisma.restaurant.findMany({
    where: { nameRo: TAG },
    include: { tables: { select: { id: true } } },
  });
  for (const old of olds) {
    const tids = old.tables.map((t) => t.id);
    if (tids.length) await prisma.tableMove.deleteMany({ where: { tableId: { in: tids } } });
    await prisma.notification.deleteMany({ where: { restaurantId: old.id } });
    await prisma.reservation.deleteMany({ where: { restaurantId: old.id } });
    await prisma.restaurant.delete({ where: { id: old.id } }).catch(() => {});
  }
}

const openAll = (open, close) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isOpen: true, openTime: open, closeTime: close }));
const closedAll = () =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isOpen: false, openTime: '10:00', closeTime: '23:00' }));

// Create a `[smoke-g5b]` restaurant with one section; `tables` is a
// list of [seatCount, gridRow, gridCol]. Returns { id }.
async function mkRestaurant({ nameEn, cuisine, hours, servicePeriods, tables }) {
  const restaurant = await prisma.restaurant.create({
    data: {
      nameRo: TAG, nameEn,
      cuisineTypes: [cuisine],
      address: 'Smoke fixture — not a real venue',
      latitude: 44.43, longitude: 26.10,
      phone: '+40700000000',
      openingHours: { create: hours },
      ...(servicePeriods ? { servicePeriods: { create: servicePeriods } } : {}),
    },
  });
  const section = await prisma.tableSection.create({
    data: { restaurantId: restaurant.id, nameRo: TAG, nameEn, gridRows: 4, gridColumns: 4 },
  });
  const created = [];
  for (let i = 0; i < tables.length; i++) {
    const [seats, row, col] = tables[i];
    created.push(await prisma.restaurantTable.create({
      data: {
        sectionId: section.id, restaurantId: restaurant.id,
        tableNumber: `G5B-${i + 1}`, seatCount: seats, gridRow: row, gridCol: col,
      },
    }));
  }
  return { id: restaurant.id, tables: created };
}

async function main() {
  console.log('[baseline] wipe prior [smoke-g5b] fixture');
  await wipeFixture();

  const D = isoDate(3);          // requested date — safely in the future
  const T = '19:00';            // requested time
  const PAST = isoDate(-3);

  console.log('[fixture] create 6 throwaway restaurants');
  const rExact = await mkRestaurant({
    nameEn: 'R-EXACT', cuisine: 'SmokeG5bExact', hours: openAll('10:00', '23:00'),
    tables: [[4, 0, 0]],
  });
  const rMerge = await mkRestaurant({
    nameEn: 'R-MERGE', cuisine: 'SmokeG5bMerge', hours: openAll('10:00', '23:00'),
    tables: [[2, 0, 0], [2, 0, 1]], // adjacent — 2+2 merge seats a party of 4
  });
  const rBusy = await mkRestaurant({
    nameEn: 'R-BUSY', cuisine: 'SmokeG5bBusy', hours: openAll('10:00', '23:00'),
    tables: [[4, 0, 0]],
  });
  const rNosp = await mkRestaurant({
    nameEn: 'R-NOSP', cuisine: 'SmokeG5bNosp', hours: openAll('10:00', '23:00'),
    servicePeriods: [{ nameRo: 'Prânz', nameEn: 'Lunch', startTime: '12:00', endTime: '15:00' }],
    tables: [[4, 0, 0]],
  });
  const rDisabled = await mkRestaurant({
    nameEn: 'R-DISABLED', cuisine: 'SmokeG5bDisabled', hours: openAll('10:00', '23:00'),
    tables: [[4, 0, 0]],
  });
  const rClosed = await mkRestaurant({
    nameEn: 'R-CLOSED', cuisine: 'SmokeG5bClosed', hours: closedAll(),
    tables: [[4, 0, 0]],
  });

  // R-BUSY: book its sole table across the requested window.
  await prisma.reservation.create({
    data: {
      restaurantId: rBusy.id, tableId: rBusy.tables[0].id,
      date: new Date(D), time: '18:30', endTime: '20:30',
      partySize: 4, status: 'CONFIRMED', source: 'APP',
    },
  });
  // R-DISABLED: mark the requested date unavailable.
  await prisma.disabledDate.create({
    data: { restaurantId: rDisabled.id, date: new Date(D), reason: 'Smoke closure' },
  });

  const login = await http('POST', '/auth/login', null, { email: 'demo@aprez.ro', password: 'user123' });
  const token = login.body?.token;
  expect(!!token, 'diner login → token');

  console.log('\n[unfiltered] GET /restaurants with no availability params');
  const unfiltered = await listRestaurants(token, {});
  expect(unfiltered.status === 200, `status=200 (got ${unfiltered.status})`);
  expect(Array.isArray(unfiltered.body), 'body is an array');
  expect(has(unfiltered.body, rExact.id), 'unfiltered includes R-EXACT');
  expect(has(unfiltered.body, rBusy.id), 'unfiltered includes R-BUSY');
  expect(has(unfiltered.body, rClosed.id), 'unfiltered includes R-CLOSED');
  const unfilteredCount = unfiltered.body.length;

  console.log('\n[all-or-none] a partial param set must NOT filter');
  const partialTwo = await listRestaurants(token, { partySize: 4, date: D });
  expect(partialTwo.status === 200, `partySize+date only → status=200 (got ${partialTwo.status})`);
  expect(has(partialTwo.body, rBusy.id), 'partySize+date only → R-BUSY still present (unfiltered)');
  const partialOne = await listRestaurants(token, { partySize: 4 });
  expect(has(partialOne.body, rNosp.id), 'partySize only → R-NOSP still present (unfiltered)');

  console.log('\n[validation] structured 400 codes');
  const p0 = await listRestaurants(token, { partySize: 0, date: D, time: T });
  expect(p0.status === 400 && p0.body?.error?.code === 'invalid-party-size', `partySize=0 → 400 invalid-party-size (got ${p0.status}/${p0.body?.error?.code})`);
  const p31 = await listRestaurants(token, { partySize: 31, date: D, time: T });
  expect(p31.status === 400 && p31.body?.error?.code === 'invalid-party-size', `partySize=31 → 400 invalid-party-size (got ${p31.status}/${p31.body?.error?.code})`);
  const pAbc = await listRestaurants(token, { partySize: 'abc', date: D, time: T });
  expect(pAbc.status === 400 && pAbc.body?.error?.code === 'invalid-party-size', `partySize=abc → 400 invalid-party-size (got ${pAbc.status}/${pAbc.body?.error?.code})`);
  const dPast = await listRestaurants(token, { partySize: 4, date: PAST, time: T });
  expect(dPast.status === 400 && dPast.body?.error?.code === 'date-in-past', `past date → 400 date-in-past (got ${dPast.status}/${dPast.body?.error?.code})`);
  const dBad = await listRestaurants(token, { partySize: 4, date: '2026-13-40', time: T });
  expect(dBad.status === 400 && dBad.body?.error?.code === 'invalid-date', `date=2026-13-40 → 400 invalid-date (got ${dBad.status}/${dBad.body?.error?.code})`);
  const tBad = await listRestaurants(token, { partySize: 4, date: D, time: '19:07' });
  expect(tBad.status === 400 && tBad.body?.error?.code === 'invalid-time', `time=19:07 → 400 invalid-time (got ${tBad.status}/${tBad.body?.error?.code})`);
  const tJunk = await listRestaurants(token, { partySize: 4, date: D, time: 'xyz' });
  expect(tJunk.status === 400 && tJunk.body?.error?.code === 'invalid-time', `time=xyz → 400 invalid-time (got ${tJunk.status}/${tJunk.body?.error?.code})`);

  console.log('\n[filtered] full party=4 / date / time filter');
  const f4 = await listRestaurants(token, { partySize: 4, date: D, time: T });
  expect(f4.status === 200, `status=200 (got ${f4.status})`);
  expect(Array.isArray(f4.body), 'body is an array');
  expect(has(f4.body, rExact.id), 'INCLUDES R-EXACT (free 4-seat table fits)');
  expect(has(f4.body, rMerge.id), 'INCLUDES R-MERGE (2+2 adjacent merge)');
  expect(!has(f4.body, rBusy.id), 'EXCLUDES R-BUSY (sole table booked)');
  expect(!has(f4.body, rNosp.id), 'EXCLUDES R-NOSP (19:00 outside the 12–15 service period)');
  expect(!has(f4.body, rDisabled.id), 'EXCLUDES R-DISABLED (date marked disabled)');
  expect(!has(f4.body, rClosed.id), 'EXCLUDES R-CLOSED (closed every day)');
  expect(f4.body.length <= unfilteredCount, 'filtered count ≤ unfiltered count');

  console.log('\n[filtered] party=5 — the 2+2 merge no longer reaches');
  const f5 = await listRestaurants(token, { partySize: 5, date: D, time: T });
  expect(!has(f5.body, rMerge.id), 'EXCLUDES R-MERGE at party 5 (2+2=4 < 5)');
  expect(!has(f5.body, rExact.id), 'EXCLUDES R-EXACT at party 5 (single 4-seat table < 5)');

  console.log('\n[compose] availability filter + cuisine');
  const fCuisine = await listRestaurants(token, { partySize: 4, date: D, time: T, cuisine: 'SmokeG5bExact' });
  expect(fCuisine.status === 200, `status=200 (got ${fCuisine.status})`);
  expect(has(fCuisine.body, rExact.id), 'cuisine=SmokeG5bExact + filter → INCLUDES R-EXACT');
  expect(!has(fCuisine.body, rMerge.id), 'cuisine=SmokeG5bExact + filter → EXCLUDES R-MERGE (other cuisine)');

  console.log('\n[compose] availability filter + lat/lng distance sort');
  const fGeo = await listRestaurants(token, { partySize: 4, date: D, time: T, lat: 44.43, lng: 26.10 });
  expect(fGeo.status === 200, `status=200 (got ${fGeo.status})`);
  expect(has(fGeo.body, rExact.id), 'lat/lng + filter → INCLUDES R-EXACT');

  console.log('\n[cleanup]');
  await wipeFixture();

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('SMOKE ERROR', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
