// Tier I commit 2 fix-the-fix #2 — extracted from the IIFE that used
// to live inline in apps/restaurant/app/dashboard/live/page.js.
//
// Why pulled out:
//   1. The previous inline IIFE re-ran on EVERY render of the live page —
//      including renders triggered by dragHover, overrideInfo, popup
//      open/close, and the 30s interval tick. None of those should
//      recompute the merge layout (which only depends on tables +
//      liveByTableId). useMemo on the caller now keys on the right
//      inputs so transient state changes don't pay the build cost.
//   2. Pure function = unit-testable. The perf smoke at
//      server/.smoke/c6-live-grid-layout-test.js asserts O(N) behavior
//      and stable output shape so future regressions surface as a
//      smoke fail, not a 45-second browser hang.
//
// Inputs:
//   tables: RestaurantTable[]  — current section's table rows
//                                (each: { id, gridRow, gridCol, status })
//   liveByTableId: { [id]: { merge: MergeGroup | null, ... } }
// Returns:
//   {
//     mergeGroups: Array<{ merge, memberRecords, bbox, isRect, dominantStatus }>,
//     claimedCells: Set<"row,col">,
//   }
// `mergeGroups` is sorted by groupId so iteration order is deterministic
// (important for React `key` stability across renders).
//
// Module is plain JS (no React imports) so Node smokes can require it
// directly. Same single-source-of-truth pattern as popupActions.js.

const STATUS_RANK = { OCCUPIED: 4, AWAITING_GUEST: 3, ARRIVING_SOON: 2, FREE: 1, OUT_OF_SERVICE: 0 };

function computeLiveGridLayout(tables, liveByTableId) {
  const mergeGroups = new Map(); // groupId → { merge, memberRecords[] }
  const claimedCells = new Set();
  if (!Array.isArray(tables) || tables.length === 0) {
    return { mergeGroups: [], claimedCells };
  }
  const sectionTableIds = new Set(tables.map((t) => t.id));

  for (const tbl of tables) {
    const merge = liveByTableId?.[tbl.id]?.merge;
    if (!merge || !merge.isActive || !merge.groupId) continue;
    if (!sectionTableIds.has(tbl.id)) continue;
    if (!mergeGroups.has(merge.groupId)) {
      mergeGroups.set(merge.groupId, { merge, memberRecords: [] });
    }
    mergeGroups.get(merge.groupId).memberRecords.push(tbl);
  }

  for (const entry of mergeGroups.values()) {
    const rs = entry.memberRecords.map((t) => t.gridRow);
    const cs = entry.memberRecords.map((t) => t.gridCol);
    const minR = Math.min(...rs);
    const maxR = Math.max(...rs);
    const minC = Math.min(...cs);
    const maxC = Math.max(...cs);
    const rowSpan = maxR - minR + 1;
    const colSpan = maxC - minC + 1;
    const area = rowSpan * colSpan;
    entry.bbox = { minR, minC, rowSpan, colSpan };
    entry.isRect = area === entry.memberRecords.length;
    entry.dominantStatus = entry.memberRecords
      .map((t) => t.status)
      .reduce((a, b) => ((STATUS_RANK[a] ?? 1) >= (STATUS_RANK[b] ?? 1) ? a : b), 'FREE');
    if (entry.isRect) {
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) claimedCells.add(`${r},${c}`);
      }
    } else {
      for (const tbl of entry.memberRecords) claimedCells.add(`${tbl.gridRow},${tbl.gridCol}`);
    }
  }

  // Deterministic order so React `key`s match across renders.
  const sortedGroups = [...mergeGroups.values()].sort((a, b) =>
    a.merge.groupId < b.merge.groupId ? -1 : a.merge.groupId > b.merge.groupId ? 1 : 0
  );
  return { mergeGroups: sortedGroups, claimedCells };
}

module.exports = { computeLiveGridLayout, STATUS_RANK };
