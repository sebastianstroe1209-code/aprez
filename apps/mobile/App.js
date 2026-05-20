import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import './src/lib/i18n'; // init i18next side-effect
import { loadStoredLocale } from './src/lib/i18n';
import { registerReminderResponseListener } from './src/lib/pushNotifications';

export default function App() {
  useEffect(() => {
    // Hydrate stored locale (SecureStore) on cold start so the first paint
    // uses the user's last choice. SPEC §11.
    loadStoredLocale();
    // J2 — wire the 45-min reminder tap handler. Tap on a reminder
    // notification opens the app and routes to the Reservations tab.
    const unsubscribe = registerReminderResponseListener();
    return unsubscribe;
  }, []);

  return (
    <AuthProvider>
      <AppNavigator />
      <StatusBar style="dark" />
    </AuthProvider>
  );
}
