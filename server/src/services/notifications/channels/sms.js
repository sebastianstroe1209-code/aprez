// SMS channel — Twilio credentials deferred to post-MVP per session decisions.
// This stub logs the payload and (when a phone is available) writes a
// Notification row so we can verify the §10 fallback routing.

async function sendSms(prisma, _io, { recipientType, userId, restaurantId, eventKey, phone, content, lang }) {
  if (!phone) return null;

  const body = lang === 'ro' ? content.bodyRo : content.bodyEn;

  console.log(`[sms:stub] event=${eventKey} phone=${phone} body="${body}"`);

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
      channel: 'sms',
      sentAt: new Date(),
    },
  });

  return notification;
}

module.exports = { sendSms };
