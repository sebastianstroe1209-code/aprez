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

// Enumerate adjacent table groupings that together seat ≥ partySize,
// ranked by free-neighbor count. BFS-grows adjacent groups (same
// section, Manhattan-1 adjacency) up to MAX_MERGE_MEMBERS starting from
// each free table, dedupes by sorted-id signature, and returns the top 3.
//
// Tier I commit 3 introduced this for the staff Quick-Add /availability
// endpoint; Tier G commit 5b moved it here (out of restaurantPlatform.
// routes.js) so the diner-facing GET /restaurants availability join can
// reuse the exact same merge-feasibility logic — one BFS, no drift.
//
// `conflictSet` (optional): when the caller already holds the set of
// busy tableIds for the window — e.g. a batched multi-restaurant join
// that fetched every restaurant's reservations in one query — it passes
// that Set and this fn skips its own per-call reservation query. When
// omitted (the original staff call site), the query runs as before.
async function computeMergeSuggestions(
  prisma, restaurantId, tables, dateObj, timeStart, timeEnd, partySize, conflictSet = null
) {
  if (!Array.isArray(tables) || tables.length < 2) return [];

  let busy = conflictSet;
  if (!busy) {
    // Reservations in the window for ALL passed tables. The caller's
    // candidate filter may have dropped tables with seatCount < party,
    // but those are still valid merge MEMBERS, so the caller passes the
    // wider pool here.
    const conflicting = await prisma.reservation.findMany({
      where: {
        restaurantId,
        date: dateObj,
        tableId: { in: tables.map((t) => t.id) },
        status: { in: ['CONFIRMED', 'PENDING', 'AUTO_CONFIRMED'] },
        AND: [{ time: { lt: timeEnd } }, { endTime: { gt: timeStart } }],
      },
      select: { tableId: true },
    });
    busy = new Set(conflicting.map((c) => c.tableId));
  }
  const free = tables.filter((t) => !busy.has(t.id));

  // Per-section adjacency map: tableId → Set of adjacent free tableIds.
  const bySection = new Map();
  for (const t of free) {
    if (!bySection.has(t.sectionId)) bySection.set(t.sectionId, []);
    bySection.get(t.sectionId).push(t);
  }
  const adjacency = new Map();
  for (const sectionTables of bySection.values()) {
    const byCell = new Map(sectionTables.map((t) => [`${t.gridRow},${t.gridCol}`, t]));
    for (const t of sectionTables) {
      const neighbors = [
        byCell.get(`${t.gridRow - 1},${t.gridCol}`),
        byCell.get(`${t.gridRow + 1},${t.gridCol}`),
        byCell.get(`${t.gridRow},${t.gridCol - 1}`),
        byCell.get(`${t.gridRow},${t.gridCol + 1}`),
      ].filter(Boolean);
      adjacency.set(t.id, new Set(neighbors.map((n) => n.id)));
    }
  }

  // More free neighbors = more combining flexibility going forward;
  // used to rank candidates that hit the partySize target equally.
  const freeNeighborCount = (tableId) => (adjacency.get(tableId)?.size || 0);

  // BFS-grow adjacent groups up to MAX_MERGE_MEMBERS (SPEC §8.2) from
  // each free table. Dedupe by sorted-id signature.
  const seen = new Set();
  const candidates = [];
  for (const start of free) {
    let frontier = [{ ids: new Set([start.id]), seats: start.seatCount }];
    for (let depth = 1; depth < MAX_MERGE_MEMBERS; depth++) {
      const next = [];
      for (const g of frontier) {
        for (const memberId of g.ids) {
          const adj = adjacency.get(memberId);
          if (!adj) continue;
          for (const adjId of adj) {
            if (g.ids.has(adjId)) continue;
            const newIds = new Set(g.ids);
            newIds.add(adjId);
            const adjTable = free.find((t) => t.id === adjId);
            if (!adjTable) continue;
            next.push({ ids: newIds, seats: g.seats + adjTable.seatCount });
          }
        }
      }
      frontier = frontier.concat(next);
    }
    for (const g of frontier) {
      if (g.ids.size < MIN_MERGE_MEMBERS) continue; // single-table "merges" aren't merges
      if (g.seats < partySize) continue;
      const sig = [...g.ids].sort().join('|');
      if (seen.has(sig)) continue;
      seen.add(sig);
      const members = [...g.ids].map((id) => free.find((t) => t.id === id)).filter(Boolean);
      const sortedNumbers = members.map((m) => m.tableNumber).sort((a, b) => {
        const na = parseInt(String(a).replace(/^T/i, ''), 10);
        const nb = parseInt(String(b).replace(/^T/i, ''), 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      });
      const totalFreeNeighbors = members.reduce((acc, m) => acc + freeNeighborCount(m.id), 0);
      candidates.push({
        tableIds: [...g.ids],
        memberLabels: sortedNumbers,
        combinedLabel: sortedNumbers.join('+'),
        summedSeatCount: g.seats,
        freeNeighborCount: totalFreeNeighbors,
      });
    }
  }
  // Ranking: fewer members first (smallest viable merge wins ties),
  // then higher free-neighbor count, then smaller summedSeatCount.
  candidates.sort((a, b) => {
    if (a.tableIds.length !== b.tableIds.length) return a.tableIds.length - b.tableIds.length;
    if (a.freeNeighborCount !== b.freeNeighborCount) return b.freeNeighborCount - a.freeNeighborCount;
    return a.summedSeatCount - b.summedSeatCount;
  });
  return candidates.slice(0, 3);
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
  computeMergeSuggestions,
};
