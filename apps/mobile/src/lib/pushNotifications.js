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

import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import api from './api';
import i18n from './i18n';

// Foreground display — without this the 45-min reminder is silent when
// the diner happens to have the app open. SPEC §5.7.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const REMINDER_CATEGORY = 'reservation-reminder';
const TOKEN_CACHE_KEY = 'aprez.expoPushToken';

// Register the §5.7 reminder's Yes/No action buttons. NOTE: the inline
// buttons only render if the server reminder push carries
// `categoryId: 'reservation-reminder'`; today the C3 push channel does
// not send it, so the reminder still delivers (title/body, tappable)
// but the buttons are pending that one-line server addition. The
// response listener below already handles the `no` action for when it
// does — see the J1b handoff note.
export async function configureReminderCategory() {
  try {
    await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
      { identifier: 'yes', buttonTitle: i18n.t('push.actionYes'), options: { opensAppToForeground: false } },
      { identifier: 'no', buttonTitle: i18n.t('push.actionNo'), options: { opensAppToForeground: true } },
    ]);
  } catch (e) {
    // Non-fatal — a category-setup failure just means no action buttons.
    console.log('[push] category setup skipped:', e?.message);
  }
}

// Permission + token registration. Safe to call repeatedly (login,
// register, cold-start). Never throws. Does NOT re-prompt a user who
// already denied — iOS treats repeated requests poorly, and a denied
// user is handled by the §10 SMS-fallback chain anyway.
export async function registerPushToken() {
  // TEMPORARY DEBUG INSTRUMENTATION — Tier J launch QA.
  // Accumulates step-by-step state and surfaces it in a single Alert at the end
  // so we can diagnose why expoPushToken isn't reaching the backend on TestFlight.
  // REMOVE this debug variant once push registration is verified working.
  const debug = [];
  try {
    debug.push('start');
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    debug.push(`perm=${status}`);
    if (status === 'undetermined') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
      debug.push(`perm-after-req=${status}`);
    }
    if (status !== 'granted') {
      Alert.alert('Push DEBUG', debug.join('\n') + '\nSTOP: no perm');
      return;
    }

    let tokenResp;
    try {
      tokenResp = await Notifications.getExpoPushTokenAsync();
    } catch (e) {
      debug.push(`getToken-throw: ${e?.name}: ${e?.message}`);
      Alert.alert('Push DEBUG', debug.join('\n'));
      return;
    }
    const token = tokenResp?.data;
    debug.push(`token=${token ? token.slice(0, 30) + '…' : 'NULL'}`);
    if (!token) {
      Alert.alert('Push DEBUG', debug.join('\n'));
      return;
    }

    // CACHE CHECK DISABLED for J launch QA — diagnostic rounds polluted
    // the DB while SecureStore retained a valid token, leaving the two
    // out of sync. Forcing every login to POST until we can re-verify
    // the cache invariant holds (then restore the early-return).
    const cached = await SecureStore.getItemAsync(TOKEN_CACHE_KEY).catch(() => null);
    debug.push(`cached-match=${cached === token} (bypassed)`);

    try {
      await api.put('/users/me/push-token', { expoPushToken: token });
      debug.push('PUT 200');
    } catch (e) {
      debug.push(`PUT-err: ${e?.response?.status || ''} ${e?.message}`);
      Alert.alert('Push DEBUG', debug.join('\n'));
      return;
    }
    await SecureStore.setItemAsync(TOKEN_CACHE_KEY, token).catch(() => {});
    Alert.alert('Push DEBUG', debug.join('\n') + '\nDONE');
  } catch (e) {
    debug.push(`OUTER: ${e?.name}: ${e?.message}`);
    Alert.alert('Push DEBUG', debug.join('\n'));
  }
}

// 45-minute reminder action handler (SPEC §5.7). Fires when the diner
// taps the notification or one of its action buttons. "No, cancel" →
// cancels the reservation; "Yes" or a plain tap → no-op (reservation
// stays active). Returns an unsubscribe fn for the caller's cleanup.
export function registerReminderResponseListener() {
  const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
    try {
      const data = response?.notification?.request?.content?.data || {};
      const action = response?.actionIdentifier;
      const reservationId = data.reservationId;
      if (action === 'no' && reservationId) {
        await api.put(`/reservations/${reservationId}/cancel`);
        Alert.alert(i18n.t('push.cancelledTitle'), i18n.t('push.cancelledBody'));
      }
      // 'yes' / default tap → nothing to do; the reservation stays active.
    } catch (e) {
      // 4xx/5xx or network — log, don't retry; the diner can still
      // cancel in-app from the reservation detail screen.
      console.log('[push] reminder action failed:', e?.message);
    }
  });
  return () => sub.remove();
}
