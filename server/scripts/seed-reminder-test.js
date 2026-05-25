// Tier J launch QA — seed a 45-minute-reminder fixture for demo@aprez.ro.
//
// Picks a CONFIRMED or AUTO_CONFIRMED reservation owned by demo@aprez.ro,
// shifts its date to today's Bucharest calendar date and its time to
// "now + 46 min" (rounded to a clean HH:mm). Clears reminderSentAt so the
// dedup column doesn't suppress firing. The cron in socket/handlers.js
// runs every 60 s and matches now+44/45/46 in Bucharest, so the next tick
// (≤60 s away) lands the reservation inside the window and fires the push.
//
// Re-runnable: each run picks the most recently CREATED eligible
// reservation, resets its reminder column, and re-shifts. After tapping
// "No, cancel" in a test round, that reservation flips to CANCELLED and
// the next run automatically picks a different one.
//
// Usage (from server/):  node scripts/seed-reminder-test.js
//
// Aborts loudly if:
//   - demo@aprez.ro not found
//   - User.expoPushToken is null (no point firing — push would no-op)
//   - no eligible reservation exists

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function bucharestParts(d) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

async function main() {
  console.log('--- 45-min reminder seed ---');

  const user = await prisma.user.findUnique({
    where: { email: 'demo@aprez.ro' },
    select: { id: true, email: true, expoPushToken: true, preferredLanguage: true },
  });
  if (!user) throw new Error('demo@aprez.ro not found in DB');

  console.log(`[user]   id=${user.id}`);
  console.log(`[user]   preferredLanguage=${user.preferredLanguage || '(default)'}`);
  console.log(`[user]   expoPushToken=${user.expoPushToken ? user.expoPushToken.slice(0, 24) + '…' : 'NULL'}`);
  if (!user.expoPushToken) {
    throw new Error(
      'No expoPushToken on demo@aprez.ro. Push would be skipped. ' +
      'Re-open the mobile app + grant notifications to register a token, then re-run.'
    );
  }

  const now = new Date();
  const { date: nowDate, time: nowTime } = bucharestParts(now);
  console.log(`[clock]  Bucharest now = ${nowDate} ${nowTime}`);

  const reservation = await prisma.reservation.findFirst({
    where: {
      userId: user.id,
      status: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] },
    },
    orderBy: { createdAt: 'desc' },
    include: { restaurant: { select: { nameRo: true, nameEn: true, reservationDurationMin: true } } },
  });
  if (!reservation) {
    throw new Error(
      'No CONFIRMED/AUTO_CONFIRMED reservation owned by demo@aprez.ro. ' +
      'Create one via the mobile app (or re-confirm an existing one) and re-run.'
    );
  }

  console.log(`[res]    id=${reservation.id}`);
  console.log(`[res]    restaurant=${reservation.restaurant?.nameRo || reservation.restaurant?.nameEn}`);
  console.log(`[res]    status=${reservation.status}`);
  console.log(`[res]    original date=${reservation.date.toISOString().slice(0, 10)} time=${reservation.time}`);
  console.log(`[res]    party=${reservation.partySize}`);

  // Target = now + 46 minutes (one minute past the cron window's far edge,
  // so the very next cron tick — within 60 s — lands it inside [+44, +46]).
  const target = new Date(now.getTime() + 46 * 60 * 1000);
  const { date: targetDate, time: targetTime } = bucharestParts(target);
  console.log(`[target] new date=${targetDate} time=${targetTime} (Bucharest)`);

  // K9 fix: recompute endTime in lockstep with time. Pre-K9 this script
  // shifted `time` without updating `endTime`, leaving rows like
  // time=00:29 endTime=21:00 in the DB — invariant-breaking and the
  // source of the K9 audit finding.
  const duration = reservation.restaurant?.reservationDurationMin || 120;
  const [tH, tM] = targetTime.split(':').map(Number);
  const endMin = (tH * 60 + tM + duration);
  const targetEndTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

  await prisma.reservation.update({
    where: { id: reservation.id },
    data: {
      date: new Date(`${targetDate}T00:00:00.000Z`),
      time: targetTime,
      endTime: targetEndTime,
      reminderSentAt: null,
    },
  });

  console.log('[ok]     reservation shifted, reminderSentAt cleared.');
  console.log('');
  console.log('Watch the backend terminal for:');
  console.log(`  [reminder:fired] reservationId=${reservation.id} time=${targetTime}`);
  console.log(`  [push:sent] event=RESERVATION_REMINDER_45 ticketId=...`);
  console.log('');
  console.log('Push should land on the phone within ~60 seconds.');
}

main()
  .catch((e) => {
    console.error('');
    console.error('!!! seed failed:');
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
