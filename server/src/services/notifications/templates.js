// Notification templates per SPEC §10. Each entry returns Romanian + English
// title and body. Time/date strings are passed pre-formatted by the caller.

const formatDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  // SPEC §11: DD-MM-YYYY for both locales
  return dt.toLocaleDateString('en-GB', { timeZone: 'Europe/Bucharest' }).replace(/\//g, '-');
};

const restaurantName = (ctx, lang) => {
  if (!ctx.restaurant) return '';
  return lang === 'ro' ? ctx.restaurant.nameRo : ctx.restaurant.nameEn;
};

const dinerName = (ctx) => {
  if (ctx.guestName) return ctx.guestName;
  if (ctx.user) return `${ctx.user.firstName} ${ctx.user.lastName}`.trim();
  return '';
};

// Event keys — single source of truth for the dispatcher and route call sites.
const EVENTS = {
  RESERVATION_AUTO_CONFIRMED:        'reservation.auto_confirmed',          // #1 diner
  RESERVATION_CONFIRMED:             'reservation.confirmed',               // #2 diner
  RESERVATION_REJECTED:              'reservation.rejected',                // #3 diner
  RESERVATION_CANCELLED_BY_RESTAURANT: 'reservation.cancelled_by_restaurant', // #4 diner
  MODIFICATION_APPROVED:             'modification.approved',               // #5 diner
  MODIFICATION_REJECTED:             'modification.rejected',               // #6 diner
  RESERVATION_REMINDER_45:           'reservation.reminder_45',             // #7 diner
  RESERVATION_REQUEST_NEW:           'reservation.request_new',             // #8 restaurant
  RESERVATION_CANCELLED_BY_DINER:    'reservation.cancelled_by_diner',      // #9 restaurant
  MODIFICATION_REQUESTED:            'modification.requested',              // #10 restaurant
  TABLE_TIMER_120_EXPIRED:           'table.timer_120_expired',             // #11 restaurant
  TABLE_AWAITING_15_REMINDER:        'table.awaiting_15_reminder',          // #12 restaurant
};

const TEMPLATES = {
  [EVENTS.RESERVATION_AUTO_CONFIRMED]: (ctx) => ({
    titleRo: 'Rezervare confirmată',
    titleEn: 'Reservation confirmed',
    bodyRo: `Rezervarea ta la ${restaurantName(ctx, 'ro')} este confirmată! ${formatDate(ctx.date)} la ${ctx.time} pentru ${ctx.partySize} persoane.`,
    bodyEn: `Your reservation at ${restaurantName(ctx, 'en')} is confirmed! ${formatDate(ctx.date)} at ${ctx.time} for ${ctx.partySize} people.`,
  }),

  [EVENTS.RESERVATION_CONFIRMED]: (ctx) => ({
    titleRo: 'Rezervare confirmată',
    titleEn: 'Reservation confirmed',
    bodyRo: `Rezervarea ta la ${restaurantName(ctx, 'ro')} a fost confirmată! ${formatDate(ctx.date)} la ${ctx.time}.`,
    bodyEn: `Your reservation at ${restaurantName(ctx, 'en')} has been confirmed! ${formatDate(ctx.date)} at ${ctx.time}.`,
  }),

  [EVENTS.RESERVATION_REJECTED]: (ctx) => ({
    titleRo: 'Rezervare indisponibilă',
    titleEn: 'Reservation unavailable',
    bodyRo: `Ne pare rău, ${restaurantName(ctx, 'ro')} nu este disponibil la ${ctx.time}. Încearcă altă oră.`,
    bodyEn: `Sorry, ${restaurantName(ctx, 'en')} isn't available at ${ctx.time}. Try a different time.`,
  }),

  [EVENTS.RESERVATION_CANCELLED_BY_RESTAURANT]: (ctx) => ({
    titleRo: 'Rezervare anulată',
    titleEn: 'Reservation cancelled',
    bodyRo: `Rezervarea ta la ${restaurantName(ctx, 'ro')} pentru ${formatDate(ctx.date)} la ${ctx.time} a fost anulată de restaurant.`,
    bodyEn: `Your reservation at ${restaurantName(ctx, 'en')} for ${formatDate(ctx.date)} at ${ctx.time} has been cancelled by the restaurant.`,
  }),

  [EVENTS.MODIFICATION_APPROVED]: (ctx) => ({
    titleRo: 'Modificare aprobată',
    titleEn: 'Modification approved',
    bodyRo: `Modificarea rezervării a fost aprobată! Detalii noi: ${formatDate(ctx.date)} la ${ctx.time} pentru ${ctx.partySize} persoane.`,
    bodyEn: `Your reservation change has been approved! New details: ${formatDate(ctx.date)} at ${ctx.time} for ${ctx.partySize} people.`,
  }),

  [EVENTS.MODIFICATION_REJECTED]: (ctx) => ({
    titleRo: 'Modificare respinsă',
    titleEn: 'Modification rejected',
    bodyRo: 'Modificarea ta nu a fost aprobată. Vrei să păstrezi rezervarea originală?',
    bodyEn: "Your modification wasn't approved. Would you like to keep your original reservation?",
  }),

  [EVENTS.RESERVATION_REMINDER_45]: (ctx) => ({
    titleRo: 'Reamintire rezervare',
    titleEn: 'Reservation reminder',
    bodyRo: `Rezervarea ta la ${restaurantName(ctx, 'ro')} este în 45 de minute. Vei ajunge?`,
    bodyEn: `Your reservation at ${restaurantName(ctx, 'en')} is in 45 minutes. Will you make it?`,
  }),

  [EVENTS.RESERVATION_REQUEST_NEW]: (ctx) => ({
    titleRo: 'Rezervare nouă',
    titleEn: 'New reservation',
    bodyRo: `Cerere nouă de rezervare: ${dinerName(ctx)}, ${formatDate(ctx.date)} la ${ctx.time}, ${ctx.partySize} persoane.`,
    bodyEn: `New reservation request: ${dinerName(ctx)}, ${formatDate(ctx.date)} at ${ctx.time}, party of ${ctx.partySize}.`,
  }),

  [EVENTS.RESERVATION_CANCELLED_BY_DINER]: (ctx) => ({
    titleRo: 'Rezervare anulată',
    titleEn: 'Reservation cancelled',
    bodyRo: `${dinerName(ctx)} a anulat rezervarea pentru ${formatDate(ctx.date)} la ${ctx.time}.`,
    bodyEn: `${dinerName(ctx)} cancelled their reservation for ${formatDate(ctx.date)} at ${ctx.time}.`,
  }),

  [EVENTS.MODIFICATION_REQUESTED]: (ctx) => ({
    titleRo: 'Solicitare modificare',
    titleEn: 'Modification requested',
    bodyRo: `${dinerName(ctx)} solicită modificarea rezervării: ${ctx.details || ''}`.trim(),
    bodyEn: `${dinerName(ctx)} requests to change their reservation: ${ctx.details || ''}`.trim(),
  }),

  [EVENTS.TABLE_TIMER_120_EXPIRED]: (ctx) => ({
    titleRo: 'Masă peste 2 ore ocupată',
    titleEn: 'Table over 2 hours seated',
    bodyRo: `Masa ${ctx.tableNumber} este ocupată de ${ctx.elapsedMinutes} minute.`,
    bodyEn: `Table ${ctx.tableNumber} has been occupied for ${ctx.elapsedMinutes} minutes.`,
  }),

  [EVENTS.TABLE_AWAITING_15_REMINDER]: (ctx) => ({
    titleRo: 'Oaspete în așteptare',
    titleEn: 'Guest awaiting',
    bodyRo: `Masa ${ctx.tableNumber} așteaptă oaspetele de ${ctx.waitingMinutes} minute.`,
    bodyEn: `Table ${ctx.tableNumber} has been awaiting guest for ${ctx.waitingMinutes} minutes.`,
  }),
};

function renderTemplate(eventKey, ctx) {
  const fn = TEMPLATES[eventKey];
  if (!fn) throw new Error(`Unknown notification event: ${eventKey}`);
  return fn(ctx);
}

module.exports = { EVENTS, renderTemplate };
