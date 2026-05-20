import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import './src/lib/i18n'; // init i18next side-effect
import { loadStoredLocale } from './src/lib/i18n';
import { configureReminderCategory, registerReminderResponseListener } from './src/lib/pushNotifications';

export default function App() {
  useEffect(() => {
    // Hydrate stored locale (SecureStore) on cold start so the first paint
    // uses the user's last choice. SPEC §11.
    loadStoredLocale();
    // J1b — register the §5.7 reminder's action category + its tap /
    // action-button response handler once, at the app root.
    configureReminderCategory();
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
