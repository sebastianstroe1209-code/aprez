// Pure, framework-free action-matrix helpers for ReservationDetailPopup.
// Extracted so the same logic is consumed by the popup AND by the
// Node smoke at server/.smoke/c6-popup-actions-test.js — single source
// of truth, no copy-paste divergence.
//
// CommonJS shape so Node can `require()` it directly. Next.js +
// Webpack handles CJS interop fine when imported via ESM `import`.
//
// Per memory/waiter_ux_strategy.md §3.1 state-action matrix.
//
// "AwaitingGuest" is a DERIVED state, not a literal reservation status —
// ReservationStatus has no AWAITING_GUEST enum (that's only a table
// status per SPEC §9.1). The reservation row is CONFIRMED /
// AUTO_CONFIRMED and the *table* flips to AWAITING_GUEST when its
// reservation time arrives without a seat. The derived check fires when
// ALL of:
//   - reservation.status ∈ { CONFIRMED, AUTO_CONFIRMED }
//   - reservation has a table assigned (tableId, table.id, OR tableLabel)
//   - reservation.seatedAt is null/undefined
//   - EITHER reservation.table.status === 'AWAITING_GUEST'
//     OR reservation.secondsLate > 0
//
// The `tableLabel` fallback in the hasTable check is a hardening step
// added after C6 end-of-phase QA: the Dashboard summary payload returns
// tableLabel but the Dashboard mount path may strip tableId, and we
// don't want to silently fail the derivation when the table is
// clearly assigned.

function hasAssignedTable(reservation) {
  if (!reservation) return false
  return !!(
    reservation.tableId ||
    reservation.table?.id ||
    reservation.tableLabel
  )
}

function isAwaitingGuestDerived(reservation) {
  if (!reservation) return false
  const status = reservation.status
  if (status !== 'CONFIRMED' && status !== 'AUTO_CONFIRMED') return false
  // seatedAt: undefined is treated as null (defensive — some endpoint
  // shapes might not include the field).
  if (reservation.seatedAt) return false
  if (!hasAssignedTable(reservation)) return false
  if (reservation.table?.status === 'AWAITING_GUEST') return true
  if (typeof reservation.secondsLate === 'number' && reservation.secondsLate > 0) return true
  return false
}

// Tier E commit 1 — modification approval branches on payload, not
// status. The diner POST /modify intentionally does NOT flip
// Reservation.status (SPEC §5.6: "original stays active") — it instead
// attaches a `modificationPending` sub-object. So any reservation with
// modificationPending.status === 'PENDING' renders the approve/reject
// pair, regardless of the literal reservation.status (typically
// CONFIRMED / AUTO_CONFIRMED, occasionally PENDING).
function hasPendingModification(reservation) {
  return !!(reservation?.modificationPending && reservation.modificationPending.status === 'PENDING')
}

// Tier I commit 2 — merge-keyed branch. When the popup opens on a
// table that's part of an active merge, the regular status-keyed action
// set still applies (Seat / Edit / Cancel / etc. operate on the group
// as a unit), but we additionally append 'unmerge' so staff can split
// the group back to its original tables. This sits AFTER the
// modification-pending early-return because that flow short-circuits
// the full action set anyway.
function hasActiveMerge(reservation) {
  return !!(reservation?.merge && reservation.merge.isActive && reservation.merge.groupId)
}

function actionsForStatus(reservation) {
  // Modification-pending takes precedence over the regular state-action
  // matrix. Staff has to decide before the row's normal lifecycle
  // continues.
  if (hasPendingModification(reservation)) {
    return ['confirm', 'reject']
  }
  const status = reservation?.status
  const hasTable = hasAssignedTable(reservation)
  const awaitingDerived = isAwaitingGuestDerived(reservation)
  let base
  switch (status) {
    case 'PENDING':
      base = ['confirm', 'reject', 'edit', 'cancel']
      break
    case 'CONFIRMED':
    case 'AUTO_CONFIRMED':
      if (awaitingDerived) {
        base = ['seat', 'noshow', 'edit', 'cancel']
      } else {
        base = hasTable
          ? ['edit', 'reassignTable', 'cancel']
          : ['edit', 'pickTable', 'cancel']
      }
      break
    case 'AWAITING_GUEST':
      // Defensive — enum doesn't include this today, but if a test
      // fixture / future migration ever supplies it, render the
      // right action set anyway.
      base = ['seat', 'noshow', 'edit', 'cancel']
      break
    case 'OCCUPIED':
      base = ['complete', 'cancel']
      break
    case 'COMPLETED':
    case 'CANCELLED':
    case 'NO_SHOW':
      base = [] // view-only
      break
    case 'MODIFICATION_PENDING':
      // Deprecated dead branch — the status is never set in practice
      // (see schema enum comment). Kept here for defense-in-depth: if a
      // legacy fixture or future migration ever produces this status,
      // surface the approve/reject pair so staff aren't stuck.
      base = ['confirm', 'reject']
      break
    default:
      base = []
  }

  // Tier I commit 2 — append 'unmerge' when the table is part of an
  // active merge group. Skip on terminal states (no useful unmerge
  // affordance on a completed/cancelled/no-showed reservation card)
  // and on Occupied (staff can't undo a merge mid-service — the merge
  // auto-deactivates when the reservation completes).
  if (hasActiveMerge(reservation) && status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'NO_SHOW' && status !== 'OCCUPIED') {
    return [...base, 'unmerge']
  }
  return base
}

module.exports = {
  hasAssignedTable,
  isAwaitingGuestDerived,
  hasPendingModification,
  hasActiveMerge,
  actionsForStatus,
}
