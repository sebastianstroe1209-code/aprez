// C1 dispatcher 12-event template-render regression. Walks every event
// in the EVENTS map and asserts the template returns non-empty
// titleRo / titleEn / bodyRo / bodyEn. Originally verified inline at
// commit time of C1 (ea3f221); promoted to a standalone smoke during
// Tier E commit 1 so Tier E + later can re-run it cheaply.

const path = require('path');
const { EVENTS, renderTemplate } = require(
  path.resolve(__dirname, '..', 'src', 'services', 'notifications', 'templates.js')
);

const ctx = {
  restaurant: { nameRo: 'Test RO', nameEn: 'Test EN' },
  user: { firstName: 'Demo', lastName: 'User' },
  guestName: 'Test Guest',
  date: new Date('2026-05-20T00:00:00.000Z'),
  time: '19:00',
  partySize: 2,
  tableNumber: 'T1',
  elapsedMinutes: 130,
  waitingMinutes: 16,
  details: 'time: 19:00 → 20:00',
};

let fail = 0;
const seen = new Set();
for (const [name, key] of Object.entries(EVENTS)) {
  seen.add(key);
  try {
    const r = renderTemplate(key, ctx);
    if (!r.titleRo || !r.titleEn || !r.bodyRo || !r.bodyEn) {
      console.log('FAIL', name, '→', JSON.stringify(r));
      fail++;
    } else {
      console.log('OK  ', name.padEnd(38), 'RO=' + JSON.stringify(r.titleRo));
    }
  } catch (e) {
    console.log('FAIL', name, e.message);
    fail++;
  }
}

const expectedCount = 12;
if (seen.size !== expectedCount) {
  console.log(`FAIL — expected ${expectedCount} events, got ${seen.size}`);
  fail++;
}

console.log(`\n${seen.size} events checked; ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
