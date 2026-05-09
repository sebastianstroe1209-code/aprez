// 45-minute reservation reminder job (SPEC §5.7).
//
// checkAndFireRemindersFor(prisma, io, now) finds confirmed/auto-confirmed
// reservations whose Bucharest wall-clock start time falls within
// [now+44min, now+46min] and fires the RESERVATION_REMINDER_45 notification
// once per reservation. Reservation.reminderSentAt is the dedup column —
// the second tick that hits the same reservation finds it set and skips.
//
// The 3-minute (44/45/46) window absorbs cron drift so a delayed tick can
// still pick up a reservation it would have missed at exact 45-min match.
// reminderSentAt prevents the within-window-multiple-times case from
// double-firing.
//
// Wall-clock matching at HH:mm precision uses Europe/Bucharest because
// Reservation.date is stored as UTC midnight of a Bucharest calendar date
// and Reservation.time is "HH:mm" Bucharest. We avoid mid-tick UTC
// arithmetic across DST boundaries by matching parts directly.

const { EVENTS, dispatchAsync } = require('../services/notifications');

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

async function checkAndFireRemindersFor(prisma, io, now) {
  // Build the {date, time} target set across the 3-minute window. Most
  // ticks see one date; the window crosses midnight Bucharest only when the
  // tick lands within ~46 minutes of midnight there.
  const targets = [44, 45, 46].map((m) => bucharestParts(new Date(now.getTime() + m * 60 * 1000)));
  const dateMap = new Map();
  for (const t of targets) {
    if (!dateMap.has(t.date)) dateMap.set(t.date, new Set());
    dateMap.get(t.date).add(t.time);
  }

  let fired = 0;
  for (const [dateStr, times] of dateMap) {
    const candidates = await prisma.reservation.findMany({
      where: {
        date: new Date(`${dateStr}T00:00:00.000Z`),
        time: { in: Array.from(times) },
        status: { in: ['CONFIRMED', 'AUTO_CONFIRMED'] },
        userId: { not: null },
        reminderSentAt: null,
      },
      select: { id: true, userId: true, restaurantId: true, date: true, time: true, partySize: true },
    });

    for (const r of candidates) {
      dispatchAsync(prisma, io, {
        event: EVENTS.RESERVATION_REMINDER_45,
        userId: r.userId,
        restaurantId: r.restaurantId,
        date: r.date,
        time: r.time,
        partySize: r.partySize,
        // Mobile reads `data.yes` / `data.no` to render the action buttons.
        data: { yes: 'confirm', no: 'cancel', reservationId: r.id },
      });
      await prisma.reservation.update({
        where: { id: r.id },
        data: { reminderSentAt: now },
      });
      console.log(`[reminder:fired] reservationId=${r.id} time=${r.time}`);
      fired++;
    }
  }
  return { fired };
}

module.exports = { checkAndFireRemindersFor };
