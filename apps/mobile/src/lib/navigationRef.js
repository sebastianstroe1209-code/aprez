// Imperative navigation ref — lets non-React contexts (e.g. push
// notification response listeners) navigate without being inside the
// component tree. Pattern from React Navigation docs.
//
// AppNavigator passes this to <NavigationContainer ref={navigationRef}>;
// pushNotifications.js calls navigateToReservations() on a reminder tap.

import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

// J2 launch-fix #2: cold-start tap on a push (phone locked → tap notification
// → app launches from scratch) calls this BEFORE NavigationContainer has
// mounted, so `isReady()` is false and the navigate silently no-op'd —
// which is why Sebastian saw Home on Build 6 instead of Reservations.
// Retry every 100 ms for up to ~5 s until the container is ready, then
// navigate. If the container never becomes ready (auth flow / loading
// state / user logged out), the retries time out and we silently give up.
export function navigateToReservations(retries = 50) {
  if (navigationRef.isReady()) {
    // The Reservations screen lives inside the tab navigator under MainTabs.
    // Nested navigate: target the parent stack route + pass screen param.
    navigationRef.navigate('MainTabs', { screen: 'Reservations' });
    return;
  }
  if (retries > 0) {
    setTimeout(() => navigateToReservations(retries - 1), 100);
  }
}
