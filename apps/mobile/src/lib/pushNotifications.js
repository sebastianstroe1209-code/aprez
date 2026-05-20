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

// Register the §5.7 reminder's Yes/No action buttons. The server's push
// channel sends `categoryId: 'reservation-reminder'` on every 45-min
// reminder, which causes iOS to render these two inline actions when the
// diner long-presses the notification on the lock screen.
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

// 45-minute reminder action handler (SPEC §5.7). Fires when the diner
// taps the notification or one of its action buttons. "No, cancel" →
// shows a confirmation Alert first (added post-Tier-J-launch QA to
// prevent accidental taps from the lock-screen long-press menu); only
// confirmed cancels hit the server. "Yes" or a plain tap → no-op
// (reservation stays active). Returns an unsubscribe fn for the
// caller's cleanup.
export function registerReminderResponseListener() {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response?.notification?.request?.content?.data || {};
    const action = response?.actionIdentifier;
    const reservationId = data.reservationId;
    if (action !== 'no' || !reservationId) return; // 'yes' / default tap → no-op

    Alert.alert(
      i18n.t('push.confirmCancelTitle'),
      i18n.t('push.confirmCancelBody'),
      [
        { text: i18n.t('push.confirmCancelKeep'), style: 'cancel' },
        {
          text: i18n.t('push.confirmCancelConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.put(`/reservations/${reservationId}/cancel`);
              Alert.alert(i18n.t('push.cancelledTitle'), i18n.t('push.cancelledBody'));
            } catch (e) {
              // 4xx/5xx or network — log, don't retry; the diner can still
              // cancel in-app from the reservation detail screen.
              console.log('[push] reminder cancel failed:', e?.message);
            }
          },
        },
      ],
      { cancelable: true },
    );
  });
  return () => sub.remove();
}
