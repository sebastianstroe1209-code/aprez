// Notification dispatcher (SPEC §10).
//
// One entry point: dispatch(prisma, io, { event, userId | restaurantId, ...ctx }).
// The dispatcher resolves the recipient, renders RO+EN content from
// templates.js, and fans out to per-event channels per the §10 matrix.
//
// Per-channel implementations live in ./channels/. Push/SMS/email are stubs
// for C1 and get real impl in C2 (Resend) and C3 (Expo Push). The in-app
// channel persists a Notification row and emits a socket event today.
//
// Channel routing rules (SPEC §10):
//
//   #1  auto_confirmed                  → push only
//   #2  confirmed                       → push primary, sms fallback
//   #3  rejected                        → push primary, sms fallback
//   #4  cancelled_by_restaurant         → push AND sms (both fire)
//   #5  modification.approved           → push only
//   #6  modification.rejected           → push primary, sms fallback
//   #7  reminder_45                     → push primary, sms fallback
//   #8  request_new   (restaurant)      → push + in-app, never sms
//   #9  cancelled_by_diner (restaurant) → push + in-app, never sms
//   #10 modification.requested (restaur)→ push + in-app, never sms
//   #11 timer_120_expired (restaurant)  → in-app only
//   #12 awaiting_15_reminder (restaur)  → in-app only

const { EVENTS, renderTemplate } = require('./templates');
const { sendInApp } = require('./channels/inApp');
const { sendPush } = require('./channels/push');
const { sendSms } = require('./channels/sms');
const { sendEmail } = require('./channels/email');

// Channel selectors. Each returns {push, sms, inApp} booleans given the
// recipient capabilities (hasPush / hasPhone — see SPEC §10 implementation).
const ROUTING = {
  // Diner events
  [EVENTS.RESERVATION_AUTO_CONFIRMED]:        ({ hasPush }) => ({ push: hasPush, sms: false, inApp: false }),
  [EVENTS.RESERVATION_CONFIRMED]:             ({ hasPush, hasPhone }) => ({ push: hasPush, sms: !hasPush && hasPhone, inApp: false }),
  [EVENTS.RESERVATION_REJECTED]:              ({ hasPush, hasPhone }) => ({ push: hasPush, sms: !hasPush && hasPhone, inApp: false }),
  [EVENTS.RESERVATION_CANCELLED_BY_RESTAURANT]: ({ hasPush, hasPhone }) => ({ push: hasPush, sms: hasPhone, inApp: false }),
  [EVENTS.MODIFICATION_APPROVED]:             ({ hasPush }) => ({ push: hasPush, sms: false, inApp: false }),
  [EVENTS.MODIFICATION_REJECTED]:             ({ hasPush, hasPhone }) => ({ push: hasPush, sms: !hasPush && hasPhone, inApp: false }),
  [EVENTS.RESERVATION_REMINDER_45]:           ({ hasPush, hasPhone }) => ({ push: hasPush, sms: !hasPush && hasPhone, inApp: false }),

  // Restaurant events (always in-app; push when staff has a token; never sms)
  [EVENTS.RESERVATION_REQUEST_NEW]:           ({ hasPush }) => ({ push: hasPush, sms: false, inApp: true }),
  [EVENTS.RESERVATION_CANCELLED_BY_DINER]:    ({ hasPush }) => ({ push: hasPush, sms: false, inApp: true }),
  [EVENTS.MODIFICATION_REQUESTED]:            ({ hasPush }) => ({ push: hasPush, sms: false, inApp: true }),
  [EVENTS.TABLE_TIMER_120_EXPIRED]:           ()           => ({ push: false, sms: false, inApp: true }),
  [EVENTS.TABLE_AWAITING_15_REMINDER]:        ()           => ({ push: false, sms: false, inApp: true }),
};

const RESTAURANT_EVENTS = new Set([
  EVENTS.RESERVATION_REQUEST_NEW,
  EVENTS.RESERVATION_CANCELLED_BY_DINER,
  EVENTS.MODIFICATION_REQUESTED,
  EVENTS.TABLE_TIMER_120_EXPIRED,
  EVENTS.TABLE_AWAITING_15_REMINDER,
]);

async function resolveRecipient(prisma, { event, userId, restaurantId }) {
  if (RESTAURANT_EVENTS.has(event)) {
    if (!restaurantId) return null;
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, nameRo: true, nameEn: true },
    });
    if (!restaurant) return null;
    // Restaurant-side events frequently reference the diner by name in their
    // body (e.g. "{guestName} cancelled their reservation"). Pull the diner
    // when the caller passed a userId so templates can render their name.
    let referencedUser = null;
    if (userId) {
      referencedUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      });
    }
    return {
      recipientType: 'restaurant',
      restaurantId,
      // Staff push tokens are not yet modeled in the schema. Until they are,
      // restaurant-side push is delivered via the in-app socket channel and
      // hasPush is forced false here so the routing skips the push step.
      hasPush: false,
      hasPhone: false,
      lang: 'ro',
      restaurant,
      user: referencedUser,
    };
  }
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, firstName: true, lastName: true, phone: true, email: true,
      fcmToken: true, preferredLanguage: true,
    },
  });
  if (!user) return null;
  // Diner-side events all reference the restaurant by name in the body. Load
  // it when the caller passed a restaurantId so templates can render it.
  let referencedRestaurant = null;
  if (restaurantId) {
    referencedRestaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, nameRo: true, nameEn: true },
    });
  }
  return {
    recipientType: 'user',
    userId,
    hasPush: !!user.fcmToken,
    hasPhone: !!user.phone,
    fcmToken: user.fcmToken,
    phone: user.phone,
    email: user.email,
    lang: user.preferredLanguage === 'en' ? 'en' : 'ro',
    user,
    restaurant: referencedRestaurant,
  };
}

async function dispatch(prisma, io, payload) {
  const { event, ...ctx } = payload;
  const router = ROUTING[event];
  if (!router) {
    console.warn(`[notifications] no routing rule for event=${event}`);
    return { skipped: true };
  }

  const recipient = await resolveRecipient(prisma, payload);
  if (!recipient) {
    console.warn(`[notifications] recipient not found for event=${event}`);
    return { skipped: true };
  }

  // Templates take a flat context. Merge recipient-derived fields (so
  // templates can reference ctx.user / ctx.restaurant without a second lookup)
  // with whatever the caller already passed.
  const renderCtx = {
    user: recipient.user,
    restaurant: ctx.restaurant || recipient.restaurant,
    ...ctx,
  };
  const content = renderTemplate(event, renderCtx);

  const route = router({ hasPush: recipient.hasPush, hasPhone: recipient.hasPhone });
  const results = { push: null, sms: null, inApp: null };
  const errors = [];

  // Each channel runs independently; one failing must not abort the others.
  const tasks = [];
  if (route.inApp) {
    tasks.push(
      sendInApp(prisma, io, {
        recipientType: recipient.recipientType,
        userId: recipient.userId,
        restaurantId: recipient.restaurantId,
        eventKey: event,
        content,
      })
        .then((r) => { results.inApp = r; })
        .catch((e) => { errors.push({ channel: 'in_app', error: e.message }); })
    );
  }
  if (route.push) {
    tasks.push(
      sendPush(prisma, io, {
        recipientType: recipient.recipientType,
        userId: recipient.userId,
        restaurantId: recipient.restaurantId,
        eventKey: event,
        fcmToken: recipient.fcmToken,
        content,
        lang: recipient.lang,
      })
        .then((r) => { results.push = r; })
        .catch((e) => { errors.push({ channel: 'push', error: e.message }); })
    );
  }
  if (route.sms) {
    tasks.push(
      sendSms(prisma, io, {
        recipientType: recipient.recipientType,
        userId: recipient.userId,
        restaurantId: recipient.restaurantId,
        eventKey: event,
        phone: recipient.phone,
        content,
        lang: recipient.lang,
      })
        .then((r) => { results.sms = r; })
        .catch((e) => { errors.push({ channel: 'sms', error: e.message }); })
    );
  }
  await Promise.all(tasks);

  for (const err of errors) {
    console.error(`[notifications] event=${event} channel=${err.channel} failed: ${err.error}`);
  }

  return { event, route, results, errors };
}

// Fire-and-forget wrapper for use inside route handlers — we don't want
// notification failures to block the HTTP response or surface as a 500.
function dispatchAsync(prisma, io, payload) {
  Promise.resolve()
    .then(() => dispatch(prisma, io, payload))
    .catch((err) => console.error(`[notifications] dispatch failed for event=${payload.event}: ${err.message}`));
}

module.exports = { EVENTS, dispatch, dispatchAsync, sendEmail };
