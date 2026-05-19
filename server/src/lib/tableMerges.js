// Tier I commit 1 — table merging utilities (SPEC §8.2).
//
// Shape decisions:
//   - All members of a single merge share `TableMove.mergeGroupId` and
//     have `isActive: true` until the unmerge endpoint flips them.
//   - The legacy `mergedWithTableId` column is left untouched (deprecated
//     in the schema comment) — no code in I1 writes or reads it.
//   - Scope: hybrid per Tier I decisions log. When `reservationId` is
//     set the merge auto-deactivates on cancel/complete/no-show; when
//     null the merge is pre-planned for a time window only and lives
//     until end-of-day cleanup (a future cron, out of I1 scope).
//
// Why a helper module rather than inline in restaurantPlatform.routes.js:
//   * adjacency BFS + merge-group composition + lifecycle hooks are
//     called from multiple sites (merge endpoint, unmerge endpoint,
//     live payload, /seat resolver, cancel/complete/no-show hooks)
//     and need ONE source of truth so the shape doesn't drift.

const MAX_MERGE_MEMBERS = 4;
const MIN_MERGE_MEMBERS = 2;

// Build the canonical "T1+T3" label from a list of table rows. Sorting
// by tableNumber gives a stable string regardless of input order so the
// label is the same no matter which member was clicked first.
function combinedLabel(tables) {
  const sorted = [...tables].sort((a, b) => {
    // tableNumber is a string like "T1", "T12". Strip the leading "T"
    // and compare numerically when possible; fall back to string sort.
    const stripT = (s) => (typeof s === 'string' ? s.replace(/^T/i, '') : '');
    const na = parseInt(stripT(a.tableNumber), 10);
    const nb = parseInt(stripT(b.tableNumber), 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a.tableNumber).localeCompare(String(b.tableNumber));
  });
  return sorted.map((t) => t.tableNumber).join('+');
}

// BFS over the member set treating each (gridRow, gridCol) as a node
// and Manhattan-1 neighbors as edges. Returns true iff the induced
// subgraph is connected — i.e. every member is reachable from any
// starting member via adjacent moves (no diagonals).
function isConnectedByAdjacency(tables) {
  if (tables.length === 0) return false;
  if (tables.length === 1) return true;
  const key = (t) => `${t.gridRow},${t.gridCol}`;
  const byKey = new Map(tables.map((t) => [key(t), t]));
  const seen = new Set([key(tables[0])]);
  const queue = [tables[0]];
  while (queue.length) {
    const cur = queue.shift();
    const neighbors = [
      [cur.gridRow - 1, cur.gridCol],
      [cur.gridRow + 1, cur.gridCol],
      [cur.gridRow, cur.gridCol - 1],
      [cur.gridRow, cur.gridCol + 1],
    ];
    for (const [r, c] of neighbors) {
      const k = `${r},${c}`;
      if (byKey.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push(byKey.get(k));
      }
    }
  }
  return seen.size === tables.length;
}

// Count the free Manhattan-1, same-section neighbors of `table`. A
// neighbor counts as free when it is active, not Occupied/OutOfService,
// and holds no conflicting reservation in the window (its id is absent
// from `busyTableIds`). Used as the SPEC §9.3 auto-confirm tiebreak:
// among equal exact-seat tables, prefer the one with the most free
// neighbors so staff keep the most room to combine later.
function countFreeAdjacents(table, allTables, busyTableIds) {
  const isFree = (t) =>
    t.isActive &&
    t.status !== 'OCCUPIED' &&
    t.status !== 'OUT_OF_SERVICE' &&
    !busyTableIds.has(t.id);
  const cells = [
    [table.gridRow - 1, table.gridCol],
    [table.gridRow + 1, table.gridCol],
    [table.gridRow, table.gridCol - 1],
    [table.gridRow, table.gridCol + 1],
  ];
  let count = 0;
  for (const [r, c] of cells) {
    const neighbor = allTables.find(
      (t) => t.id !== table.id && t.sectionId === table.sectionId &&
        t.gridRow === r && t.gridCol === c,
    );
    if (neighbor && isFree(neighbor)) count++;
  }
  return count;
}

// HH:mm minute-of-day helper. Returns minutes since 00:00.
function hhmmToMin(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

// True iff the [aStart, aEnd) and [bStart, bEnd) HH:mm ranges overlap.
// End is exclusive — touching boundaries (e.g. 21:00 - 21:00) do NOT
// overlap. Mirrors the reservation duration boundary rule in SPEC §9.2.
function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = hhmmToMin(aStart);
  const ae = hhmmToMin(aEnd);
  const bs = hhmmToMin(bStart);
  const be = hhmmToMin(bEnd);
  return as < be && bs < ae;
}

// Fetch the active merge group a given tableId belongs to (if any) on a
// specific date + time window. Returns the row plus group members, or
// null when the table is not part of any active merge.
async function findActiveMergeForTable(prisma, tableId, dateObj, timeStart, timeEnd) {
  // Latest active TableMove for this tableId on the date.
  const ownRow = await prisma.tableMove.findFirst({
    where: { tableId, isActive: true, date: dateObj, mergeGroupId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  if (!ownRow) return null;
  if (timeStart && timeEnd && !timeRangesOverlap(ownRow.timeStart, ownRow.timeEnd, timeStart, timeEnd)) {
    return null;
  }
  return loadMergeGroup(prisma, ownRow.mergeGroupId);
}

// Materialize a merge group: returns { groupId, members, summedSeatCount,
// combinedLabel, originalCells, isActive, date, timeStart, timeEnd,
// reservationId } or null. Always returns the latest active state.
async function loadMergeGroup(prisma, groupId) {
  if (!groupId) return null;
  const rows = await prisma.tableMove.findMany({
    where: { mergeGroupId: groupId, isActive: true },
    include: {
      table: { select: { id: true, tableNumber: true, seatCount: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) return null;
  const members = rows.map((r) => ({
    id: r.tableId,
    tableNumber: r.table?.tableNumber || '',
    seatCount: r.table?.seatCount || 0,
    originalCell: { row: r.originalGridRow, col: r.originalGridCol },
    movedCell: { row: r.movedGridRow, col: r.movedGridCol },
  }));
  const summedSeatCount = members.reduce((acc, m) => acc + m.seatCount, 0);
  return {
    groupId,
    members,
    summedSeatCount,
    combinedLabel: combinedLabel(members),
    isActive: true,
    date: rows[0].date,
    timeStart: rows[0].timeStart,
    timeEnd: rows[0].timeEnd,
    reservationId: rows[0].reservationId || null,
  };
}

// Build the map { [tableId]: mergeSubObject | null } for every table the
// caller already has loaded. Used by the live payload to attach merge
// metadata in one round-trip. Restricts to merges that overlap "right
// now" (today + current HH:mm window) so closed reservations don't bleed.
async function activeMergeMapForRestaurant(prisma, restaurantId, dateObj, nowHm) {
  // Pull every active merge row for the restaurant on the date. The join
  // through the table → restaurantId scopes correctly without adding a
  // denormalized restaurantId on TableMove.
  const rows = await prisma.tableMove.findMany({
    where: {
      isActive: true,
      date: dateObj,
      mergeGroupId: { not: null },
      table: { restaurantId },
    },
    include: { table: { select: { id: true, tableNumber: true, seatCount: true } } },
  });

  // Group by mergeGroupId.
  const byGroup = new Map();
  for (const r of rows) {
    if (!byGroup.has(r.mergeGroupId)) byGroup.set(r.mergeGroupId, []);
    byGroup.get(r.mergeGroupId).push(r);
  }

  // Filter to groups whose window covers nowHm (so a 19:00-21:00 merge
  // doesn't display on the live floor at 22:30). Pre-merges for later
  // tonight stay hidden until their window starts; matches the spec's
  // "moved tables only appear moved for that specific time block."
  const out = new Map(); // tableId -> merge object
  for (const [groupId, groupRows] of byGroup.entries()) {
    const first = groupRows[0];
    const insideWindow = nowHm
      ? (hhmmToMin(first.timeStart) <= hhmmToMin(nowHm) && hhmmToMin(nowHm) < hhmmToMin(first.timeEnd))
      : true;
    if (!insideWindow) continue;

    const members = groupRows.map((r) => ({
      id: r.tableId,
      tableNumber: r.table?.tableNumber || '',
      seatCount: r.table?.seatCount || 0,
      originalCell: { row: r.originalGridRow, col: r.originalGridCol },
      movedCell: { row: r.movedGridRow, col: r.movedGridCol },
    }));
    const summed = members.reduce((acc, m) => acc + m.seatCount, 0);
    const mergeObj = {
      groupId,
      members: members.map(({ id, tableNumber }) => ({ id, tableNumber })),
      summedSeatCount: summed,
      combinedLabel: combinedLabel(members),
      originalCell: members[0].originalCell, // for backward-render hint; full list is in members
      isActive: true,
    };
    for (const m of members) out.set(m.id, mergeObj);
  }
  return out;
}

// Lifecycle hook: when a reservation is cancelled / completed / no-shown,
// deactivate any merge group bound to that reservation. Per Tier I
// decision 2 (hybrid scope): merges with reservationId set are tied to
// the reservation's lifecycle; pre-merges with null reservationId stay
// until end-of-day cleanup.
async function deactivateMergesForReservation(prisma, reservationId) {
  if (!reservationId) return { deactivatedGroups: [] };
  const rows = await prisma.tableMove.findMany({
    where: { reservationId, isActive: true, mergeGroupId: { not: null } },
    select: { id: true, mergeGroupId: true },
  });
  const groups = [...new Set(rows.map((r) => r.mergeGroupId))];
  if (groups.length === 0) return { deactivatedGroups: [] };
  await prisma.tableMove.updateMany({
    where: { mergeGroupId: { in: groups }, isActive: true },
    data: { isActive: false },
  });
  return { deactivatedGroups: groups };
}

module.exports = {
  MAX_MERGE_MEMBERS,
  MIN_MERGE_MEMBERS,
  combinedLabel,
  isConnectedByAdjacency,
  countFreeAdjacents,
  timeRangesOverlap,
  hhmmToMin,
  findActiveMergeForTable,
  loadMergeGroup,
  activeMergeMapForRestaurant,
  deactivateMergesForReservation,
};
