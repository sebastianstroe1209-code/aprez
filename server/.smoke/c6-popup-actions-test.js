// Smoke for the popup's action-matrix derivation.
// Imports the REAL helper (apps/restaurant/lib/popupActions.js) so any
// future divergence between popup logic and this test would surface
// immediately. Covers four scenarios — including the C6 post-QA fix
// for the Dashboard-summary mount path where tableLabel exists but
// tableId might be stripped.
//
// Run: cd server && node .smoke/c6-popup-actions-test.js

const path = require('path');
const { actionsForStatus, isAwaitingGuestDerived } = require(
  path.resolve(__dirname, '..', '..', 'apps', 'restaurant', 'lib', 'popupActions.js')
);

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) console.log('     expected:', e, '\n     actual:  ', a);
  return ok;
}

let pass = 0, fail = 0;
function check(...args) { (eq(...args) ? pass++ : fail++); }

// ============================================================
// SCENARIO A — Smith Family via Live mount path.
// reservation.status = CONFIRMED (from amended /layout/live summary).
// reservation.table.status = AWAITING_GUEST (Live page passes the table
// row with status). secondsLate present but the table.status path
// short-circuits first.
// ============================================================
const SMITH_LIVE = {
  status: 'CONFIRMED',
  tableId: 't3',
  seatedAt: null,
  table: { id: 't3', status: 'AWAITING_GUEST' },
  secondsLate: 1200,
};
check('A Smith via Live: isAwaitingGuestDerived', isAwaitingGuestDerived(SMITH_LIVE), true);
check('A Smith via Live: actionsForStatus',
  actionsForStatus(SMITH_LIVE),
  ['seat', 'noshow', 'edit', 'cancel']);

// ============================================================
// SCENARIO B — Smith Family via Dashboard summary mount path.
// The Dashboard payload has tableLabel + secondsLate + status +
// (post-fix) tableId + seatedAt — no nested table.status.
// Derivation falls through to the secondsLate > 0 path.
// ============================================================
const SMITH_DASHBOARD = {
  status: 'CONFIRMED',
  tableId: 't3',           // present after C6 post-QA fix-the-fix
  tableLabel: 'T3',
  seatedAt: null,          // present after C6 post-QA fix-the-fix
  hasSpecialRequests: false,
  secondsLate: 1200,
};
check('B Smith via Dashboard: isAwaitingGuestDerived', isAwaitingGuestDerived(SMITH_DASHBOARD), true);
check('B Smith via Dashboard: actionsForStatus',
  actionsForStatus(SMITH_DASHBOARD),
  ['seat', 'noshow', 'edit', 'cancel']);

// ============================================================
// SCENARIO B' — Smith Family via Dashboard summary, hardened path:
// hypothetically tableId stripped (legacy payload) but tableLabel
// present. The hasAssignedTable fallback should still treat the row
// as having a table.
// ============================================================
const SMITH_DASHBOARD_LEGACY = {
  status: 'CONFIRMED',
  tableLabel: 'T3',
  seatedAt: null,
  secondsLate: 1200,
};
check("B' Smith Dashboard legacy (no tableId): isAwaitingGuestDerived",
  isAwaitingGuestDerived(SMITH_DASHBOARD_LEGACY), true);
check("B' Smith Dashboard legacy: actionsForStatus",
  actionsForStatus(SMITH_DASHBOARD_LEGACY),
  ['seat', 'noshow', 'edit', 'cancel']);

// ============================================================
// SCENARIO C — Daniel Vlad (AUTO_CONFIRMED, no table assigned).
// Derived MUST be false — no table to seat at. Action set is the
// pre-fix "Pick table" path.
// ============================================================
const DANIEL = {
  status: 'AUTO_CONFIRMED',
  tableId: null,
  seatedAt: null,
};
check('C Daniel (no table): isAwaitingGuestDerived', isAwaitingGuestDerived(DANIEL), false);
check('C Daniel (no table): actionsForStatus',
  actionsForStatus(DANIEL),
  ['edit', 'pickTable', 'cancel']);

// ============================================================
// SCENARIO D — Florin Tudor: CONFIRMED, table is FREE (not awaiting),
// not late. Derived MUST be false. Action set is the regular
// confirmed-with-table path.
// ============================================================
const FLORIN = {
  status: 'CONFIRMED',
  tableId: 't12',
  seatedAt: null,
  table: { id: 't12', status: 'FREE' },
  secondsLate: null,
};
check('D Florin future (table FREE, not late): isAwaitingGuestDerived', isAwaitingGuestDerived(FLORIN), false);
check('D Florin future: actionsForStatus',
  actionsForStatus(FLORIN),
  ['edit', 'reassignTable', 'cancel']);

// ============================================================
// SCENARIO E — sanity: a seated reservation. Derived MUST be false
// even if table.status === AWAITING_GUEST (defensive — seated guests
// don't need the Seat action).
// ============================================================
const SEATED = {
  status: 'CONFIRMED',
  tableId: 't5',
  seatedAt: new Date(),
  table: { id: 't5', status: 'AWAITING_GUEST' },
  secondsLate: 1200,
};
check('E Seated reservation: isAwaitingGuestDerived', isAwaitingGuestDerived(SEATED), false);

// ============================================================
// SCENARIO F — Pending: regression check. Always returns the pending
// action set regardless of table/late state.
// ============================================================
const PENDING = {
  status: 'PENDING',
  tableId: null,
  seatedAt: null,
};
check('F Pending: actionsForStatus', actionsForStatus(PENDING), ['confirm', 'reject', 'edit', 'cancel']);

// ============================================================
// SCENARIO G — Tier E commit 1: modification-pending on a CONFIRMED
// reservation. The modification-pending sub-object takes precedence
// over the normal CONFIRMED action matrix and surfaces only the
// approve/reject pair.
// ============================================================
const MOD_PENDING_ON_CONFIRMED = {
  status: 'CONFIRMED',
  tableId: 't9',
  seatedAt: null,
  table: { id: 't9', status: 'FREE' },
  modificationPending: {
    id: 'mod-1',
    status: 'PENDING',
    requestedTime: '20:00',
  },
};
check('G Modification pending on CONFIRMED: actionsForStatus',
  actionsForStatus(MOD_PENDING_ON_CONFIRMED),
  ['confirm', 'reject']);

// ============================================================
// SCENARIO H — modification sub-object exists but status is APPROVED
// (resolved). Should fall through to the normal CONFIRMED matrix.
// ============================================================
const MOD_RESOLVED_ON_CONFIRMED = {
  status: 'CONFIRMED',
  tableId: 't9',
  seatedAt: null,
  table: { id: 't9', status: 'FREE' },
  modificationPending: { id: 'mod-2', status: 'APPROVED' },
};
check('H Modification resolved on CONFIRMED: actionsForStatus',
  actionsForStatus(MOD_RESOLVED_ON_CONFIRMED),
  ['edit', 'reassignTable', 'cancel']);

// ============================================================
// SCENARIO I — Legacy: literal MODIFICATION_PENDING status (never set
// in practice today, but kept as a defensive branch). Should return
// approve/reject.
// ============================================================
const LEGACY_MOD_STATUS = { status: 'MODIFICATION_PENDING' };
check('I Legacy MODIFICATION_PENDING status: actionsForStatus',
  actionsForStatus(LEGACY_MOD_STATUS),
  ['confirm', 'reject']);

// ============================================================
// SCENARIO J — Tier I commit 2: merge !== null on a CONFIRMED reservation
// appends 'unmerge' to the regular action set. Modification-pending
// still wins (J' below).
// ============================================================
const MERGED_CONFIRMED = {
  status: 'CONFIRMED',
  tableId: 't9',
  seatedAt: null,
  table: { id: 't9', status: 'FREE' },
  merge: { groupId: 'g1', isActive: true, summedSeatCount: 4, combinedLabel: 'T9+T10' },
};
check('J Merged CONFIRMED (with table): actionsForStatus',
  actionsForStatus(MERGED_CONFIRMED),
  ['edit', 'reassignTable', 'cancel', 'unmerge']);

// ============================================================
// SCENARIO J' — merge !== null but reservation is OCCUPIED: 'unmerge'
// is suppressed (merge auto-deactivates on reservation completion;
// staff shouldn't split mid-service).
// ============================================================
const MERGED_OCCUPIED = {
  status: 'OCCUPIED',
  tableId: 't9',
  seatedAt: new Date(),
  merge: { groupId: 'g1', isActive: true, summedSeatCount: 4, combinedLabel: 'T9+T10' },
};
check("J' Merged OCCUPIED: 'unmerge' suppressed",
  actionsForStatus(MERGED_OCCUPIED),
  ['complete', 'cancel']);

// ============================================================
// SCENARIO J'' — merge present but isActive=false (e.g., stale payload
// after auto-deactivation). Should NOT include 'unmerge'.
// ============================================================
const STALE_MERGE = {
  status: 'CONFIRMED',
  tableId: 't9',
  seatedAt: null,
  table: { id: 't9', status: 'FREE' },
  merge: { groupId: 'g1', isActive: false, summedSeatCount: 4, combinedLabel: 'T9+T10' },
};
check("J'' Stale merge (isActive=false): no 'unmerge'",
  actionsForStatus(STALE_MERGE),
  ['edit', 'reassignTable', 'cancel']);

// ============================================================
// SCENARIO J''' — both merge AND modification-pending on the same
// reservation: modification-pending takes precedence (matches the
// "staff must decide modification first" intent of E1).
// ============================================================
const MERGE_AND_MOD = {
  status: 'CONFIRMED',
  tableId: 't9',
  seatedAt: null,
  table: { id: 't9', status: 'FREE' },
  merge: { groupId: 'g1', isActive: true, summedSeatCount: 4 },
  modificationPending: { id: 'm1', status: 'PENDING' },
};
check("J''' Merge + modification-pending: mod wins",
  actionsForStatus(MERGE_AND_MOD),
  ['confirm', 'reject']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
