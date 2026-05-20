// Imperative navigation ref — lets non-React contexts (e.g. push
// notification response listeners) navigate without being inside the
// component tree. Pattern from React Navigation docs.
//
// AppNavigator passes this to <NavigationContainer ref={navigationRef}>;
// pushNotifications.js calls navigateToReservations() on a reminder tap.

import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigateToReservations() {
  if (!navigationRef.isReady()) return;
  // The Reservations screen lives inside the tab navigator under MainTabs.
  // Nested navigate: target the parent stack route + pass screen param.
  navigationRef.navigate('MainTabs', { screen: 'Reservations' });
}
