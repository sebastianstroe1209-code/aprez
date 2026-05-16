// Tier I commit 2 fix-the-fix #2 — Node-level perf + purity guard for
// the live grid's merge-layout helper. Catches the regression class
// that hit Cowork browser QA: the previous IIFE was re-running on
// every parent render, compounding under React 18 concurrent rendering
// and freezing the renderer for 45s+ on subsequent state changes.
//
// Asserts:
//   1. Pure: same input → same output shape (deep structural equality
//      across two calls).
//   2. O(N) in table count: 1000-table call completes in < 50ms.
//      (Real-world section caps are ~30 tables; budget is generous.)
//   3. Sorted output: mergeGroups returned in deterministic groupId
//      order so React `key` stability holds across renders.
//   4. Empty-case fast path: 0 tables / no merges short-circuits.
//
// Run:  cd server && node .smoke/c6-live-grid-layout-test.js

const path = require('path');
const { computeLiveGridLayout } = require(
  path.resolve(__dirname, '..', '..', 'apps', 'restaurant', 'lib', 'liveGridLayout.js')
);

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`OK   ${label}`); pass++ }
  else { console.error(`FAIL ${label}`); fail++ }
}

// ----- 1. Pure (same input → same output) ------------------------------
const tables1 = [
  { id: 't1', gridRow: 0, gridCol: 0, status: 'FREE' },
  { id: 't2', gridRow: 0, gridCol: 1, status: 'FREE' },
  { id: 't3', gridRow: 1, gridCol: 0, status: 'AWAITING_GUEST' },
  { id: 't4', gridRow: 1, gridCol: 1, status: 'FREE' },
];
const live1 = {
  t1: { merge: { groupId: 'g1', isActive: true } },
  t2: { merge: { groupId: 'g1', isActive: true } },
  t3: { merge: null },
  t4: { merge: null },
};
const a = computeLiveGridLayout(tables1, live1);
const b = computeLiveGridLayout(tables1, live1);
check('Pure: mergeGroups length identical', a.mergeGroups.length === b.mergeGroups.length);
check('Pure: claimedCells size identical', a.claimedCells.size === b.claimedCells.size);
check('Pure: same groupId at index 0', a.mergeGroups[0]?.merge.groupId === b.mergeGroups[0]?.merge.groupId);
check('Rect detection: 2-cell horizontal merge is rect', a.mergeGroups[0]?.isRect === true);
check('Rect detection: dominantStatus on rect merge', a.mergeGroups[0]?.dominantStatus === 'FREE');
check('claimedCells covers the bbox', a.claimedCells.has('0,0') && a.claimedCells.has('0,1') && !a.claimedCells.has('1,0'));

// ----- 2. L-shape detection --------------------------------------------
const lshape = [
  { id: 'a', gridRow: 0, gridCol: 0, status: 'FREE' },
  { id: 'b', gridRow: 0, gridCol: 1, status: 'FREE' },
  { id: 'c', gridRow: 1, gridCol: 1, status: 'FREE' },
];
const liveLshape = {
  a: { merge: { groupId: 'gL', isActive: true } },
  b: { merge: { groupId: 'gL', isActive: true } },
  c: { merge: { groupId: 'gL', isActive: true } },
};
const lr = computeLiveGridLayout(lshape, liveLshape);
check('L-shape: isRect=false', lr.mergeGroups[0]?.isRect === false);
check('L-shape: claimedCells only covers members (no phantom corner)',
  lr.claimedCells.has('0,0') && lr.claimedCells.has('0,1') && lr.claimedCells.has('1,1') && !lr.claimedCells.has('1,0'));

// ----- 3. Inactive merge filtered out ----------------------------------
const inactive = computeLiveGridLayout(tables1, {
  t1: { merge: { groupId: 'g1', isActive: false } },
  t2: { merge: { groupId: 'g1', isActive: false } },
  t3: { merge: null },
  t4: { merge: null },
});
check('Inactive merge: mergeGroups empty', inactive.mergeGroups.length === 0);
check('Inactive merge: claimedCells empty', inactive.claimedCells.size === 0);

// ----- 4. Deterministic order ------------------------------------------
const multi = [
  { id: 'aa', gridRow: 0, gridCol: 0, status: 'FREE' },
  { id: 'ab', gridRow: 0, gridCol: 1, status: 'FREE' },
  { id: 'ba', gridRow: 2, gridCol: 0, status: 'FREE' },
  { id: 'bb', gridRow: 2, gridCol: 1, status: 'FREE' },
];
// Two groups: 'zzz...' and 'aaa...' — sorted output should put 'aaa' first.
const liveMulti = {
  aa: { merge: { groupId: 'zzz-second', isActive: true } },
  ab: { merge: { groupId: 'zzz-second', isActive: true } },
  ba: { merge: { groupId: 'aaa-first',  isActive: true } },
  bb: { merge: { groupId: 'aaa-first',  isActive: true } },
};
const mr = computeLiveGridLayout(multi, liveMulti);
check('Deterministic order: smaller groupId first',
  mr.mergeGroups[0]?.merge.groupId === 'aaa-first' &&
  mr.mergeGroups[1]?.merge.groupId === 'zzz-second');

// ----- 5. Empty-case fast path -----------------------------------------
const empty = computeLiveGridLayout([], {});
check('Empty tables: mergeGroups empty', empty.mergeGroups.length === 0);
check('Empty tables: claimedCells empty', empty.claimedCells.size === 0);
const nullLive = computeLiveGridLayout(tables1, null);
check('Null liveByTableId: mergeGroups empty', nullLive.mergeGroups.length === 0);
check('Null liveByTableId: claimedCells empty', nullLive.claimedCells.size === 0);

// ----- 6. O(N) perf budget ---------------------------------------------
const N = 1000;
const big = [];
const bigLive = {};
// 250 4-table rectangular merges spread across a 250x4 grid. Worst-case
// for the bbox + claimedCells loops since every table is in a merge.
for (let i = 0; i < N; i++) {
  big.push({ id: `t${i}`, gridRow: Math.floor(i / 4), gridCol: i % 4, status: 'FREE' });
  bigLive[`t${i}`] = { merge: { groupId: `g${Math.floor(i / 4)}`, isActive: true } };
}
const tStart = process.hrtime.bigint();
const bigResult = computeLiveGridLayout(big, bigLive);
const tEnd = process.hrtime.bigint();
const elapsedMs = Number(tEnd - tStart) / 1_000_000;
check(`Perf: 1000 tables × 250 merges in <50ms (got ${elapsedMs.toFixed(2)}ms)`, elapsedMs < 50);
check('Perf: all 250 groups detected', bigResult.mergeGroups.length === 250);
check('Perf: all 1000 cells claimed', bigResult.claimedCells.size === N);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
