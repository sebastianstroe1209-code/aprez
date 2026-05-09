// Push channel — Expo Push transport. Posts to Expo's REST endpoint
// (https://exp.host/--/api/v2/push/send) with a single-element batch body
// per call. The endpoint accepts plain HTTPS POST so no SDK is needed; the
// optional EXPO_ACCESS_TOKEN env var enables Bearer auth for higher-volume
// usage (free unauthenticated tier is fine for MVP).
//
// Push is the primary diner channel per SPEC §10. Failures (network,
// non-200, bad token) are logged and never thrown past the dispatcher so a
// bad push cannot break the calling flow.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN || null;
const TOKEN_PATTERN = /^Exp(onent)?PushToken\[[^\]]+\]$/;

let warnedAboutMissingAccessToken = false;

function maybeLogAccessTokenNote() {
  if (!ACCESS_TOKEN && !warnedAboutMissingAccessToken) {
    console.log('[push] EXPO_ACCESS_TOKEN not set — Expo Push running unauthenticated (acceptable for MVP volume).');
    warnedAboutMissingAccessToken = true;
  }
}

async function sendPush(prisma, _io, { recipientType, userId, restaurantId, eventKey, expoPushToken, content, lang, data }) {
  if (!expoPushToken) {
    console.log(`[push:skip] event=${eventKey} reason=no_token`);
    return null;
  }
  if (!TOKEN_PATTERN.test(expoPushToken)) {
    console.warn(`[push:skip] event=${eventKey} reason=bad_token_format token=${expoPushToken.slice(0, 24)}…`);
    return null;
  }

  maybeLogAccessTokenNote();

  const title = lang === 'ro' ? content.titleRo : content.titleEn;
  const body = lang === 'ro' ? content.bodyRo : content.bodyEn;

  const message = {
    to: expoPushToken,
    title,
    body,
    sound: 'default',
  };
  if (data && typeof data === 'object') message.data = data;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
  if (ACCESS_TOKEN) headers.Authorization = `Bearer ${ACCESS_TOKEN}`;

  let resp;
  try {
    resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify([message]),
    });
  } catch (err) {
    console.error(`[push:error] event=${eventKey} network: ${err.message}`);
    return { error: err.message };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[push:error] event=${eventKey} http=${resp.status} body=${text.slice(0, 200)}`);
    return { error: `http_${resp.status}` };
  }

  let json;
  try {
    json = await resp.json();
  } catch (err) {
    console.error(`[push:error] event=${eventKey} bad_json: ${err.message}`);
    return { error: 'bad_json' };
  }

  // Expo response shape: { data: [{ status, id?, message?, details? }] }
  // For a single-message batch, data[0] is our ticket. status is "ok" on
  // success or "error" with a code when the ticket itself failed.
  const ticket = json && Array.isArray(json.data) ? json.data[0] : null;
  if (!ticket) {
    console.error(`[push:error] event=${eventKey} no_ticket_in_response: ${JSON.stringify(json).slice(0, 200)}`);
    return { error: 'no_ticket' };
  }
  if (ticket.status !== 'ok') {
    console.error(`[push:error] event=${eventKey} ticket_status=${ticket.status} msg=${ticket.message || ''}`);
    return { error: ticket.status, ticket };
  }

  console.log(`[push:sent] event=${eventKey} ticketId=${ticket.id}`);

  // Persist a record so the Notifications table reflects all four channels.
  // Mirrors the in-app/sms/email pattern in the rest of the dispatcher.
  await prisma.notification.create({
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

  return { ticketId: ticket.id };
}

module.exports = { sendPush };
