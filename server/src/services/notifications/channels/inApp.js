// In-app channel: persists a Notification row and emits a socket event so
// connected clients (mobile diner, restaurant dashboard) can show a toast or
// update a badge without refresh.

async function sendInApp(prisma, io, { recipientType, userId, restaurantId, eventKey, content }) {
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
      channel: 'in_app',
      sentAt: new Date(),
    },
  });

  if (io) {
    const room = recipientType === 'user' ? `user:${userId}` : `restaurant:${restaurantId}`;
    io.to(room).emit('notification:new', {
      id: notification.id,
      type: notification.type,
      titleRo: notification.titleRo,
      titleEn: notification.titleEn,
      bodyRo: notification.bodyRo,
      bodyEn: notification.bodyEn,
      createdAt: notification.createdAt,
    });
  }

  return notification;
}

module.exports = { sendInApp };
