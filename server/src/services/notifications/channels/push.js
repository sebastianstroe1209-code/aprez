// Push channel — Expo Push integration lands in C3. For now this stub logs
// the payload and writes a Notification row so we can verify routing without
// real FCM tokens. Per SPEC §10, push is the primary channel for most diner
// events and a co-channel for restaurant events.

async function sendPush(prisma, io, { recipientType, userId, restaurantId, eventKey, fcmToken, content, lang }) {
  // No token = no push. Caller (dispatcher) decides whether SMS fallback fires.
  if (!fcmToken) return null;

  const title = lang === 'ro' ? content.titleRo : content.titleEn;
  const body = lang === 'ro' ? content.bodyRo : content.bodyEn;

  console.log(`[push:stub] event=${eventKey} token=${fcmToken.slice(0, 8)}… title="${title}" body="${body}"`);

  const notification = await prisma.notification.create({
    data: {
      recipientType,
      userId: userId || null,
      restaurantId: restaurantId || null,
      type: eventKey,
      titleRo: content.titleRo,
      titleEn: content.titleEn,
      bodyRo: content.bodyRo,
      bodyEn: content.bodyEn,
      channel: 'push',
      sentAt: new Date(),
    },
  });

  return notification;
}

module.exports = { sendPush };
