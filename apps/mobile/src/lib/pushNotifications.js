// Tier J launch-fix 1b — Expo push token registration + the §5.7
// 45-minute-reminder action handler.
//
// The backend push pipeline (dispatcher, Expo Push transport, reminder
// job) shipped in Tier C3, but the mobile app never obtained or
// uploaded a push token — so the diner's `User.expoPushToken` stayed
// null and every push silently no-op'd. This module closes that gap.
//
// Everything here is defensive: a denied permission, an offline Expo
// backend, or a failed POST must never crash the app or block login —
// they just mean "no push this session", retried on the next app start.

import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import api from './api';
import { navigateToReservations } from './navigationRef';

// Foreground display — without this the 45-min reminder is silent when
// the diner happens to have the app open. SPEC §5.7.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const TOKEN_CACHE_KEY = 'aprez.expoPushToken';

// NOTE: J2 launch-fix removed the Yes/No action-button category. iOS's
// long-press-to-reveal gesture proved too discoverable a UX for the
// average diner — most just single-tapped the notification, which fell
// through to the default-action path (no buttons rendered). The simpler
// MVP behavior: tap = open app to Reservations tab; cancel happens via
// the existing in-app reservation card flow. See registerReminderResponseListener
// below for the tap handler.

// Permission + token registration. Safe to call repeatedly (login,
// register, cold-start). Never throws. Does NOT re-prompt a user who
// already denied — iOS treats repeated requests poorly, and a denied
// user is handled by the §10 SMS-fallback chain anyway.
export async function registerPushToken() {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status === 'undetermined') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return; // denied / still-undetermined — stop, don't nag

    const tokenResp = await Notifications.getExpoPushTokenAsync();
    const token = tokenResp?.data;
    if (!token) return;

    // Only POST when the token differs from what we last uploaded —
    // covers token rotation without a needless request every launch.
    const cached = await SecureStore.getItemAsync(TOKEN_CACHE_KEY).catch(() => null);
    if (cached === token) return;

    await api.put('/users/me/push-token', { expoPushToken: token });
    await SecureStore.setItemAsync(TOKEN_CACHE_KEY, token).catch(() => {});
  } catch (e) {
    // Permission / Expo-backend / network / POST failure — log, never
    // crash, never retry in a tight loop. Re-attempted on next start.
    console.log('[push] token registration skipped:', e?.message);
  }
}

// 45-minute reminder tap handler (SPEC §5.7, simplified J2). Any tap on
// the notification (banner, banner detail, or default cold-start launch
// via the notification) navigates the diner to the Reservations tab.
// They can cancel from there using the existing in-app flow if they
// need to. Returns an unsubscribe fn for the caller's cleanup.
export function registerReminderResponseListener() {
  const sub = Notifications.addNotificationResponseReceivedListener(() => {
    navigateToReservations();
  });
  return () => sub.remove();
}
