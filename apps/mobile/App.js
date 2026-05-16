import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import './src/lib/i18n'; // init i18next side-effect
import { loadStoredLocale } from './src/lib/i18n';

export default function App() {
  useEffect(() => {
    // Hydrate stored locale (SecureStore) on cold start so the first paint
    // uses the user's last choice. SPEC §11.
    loadStoredLocale();
  }, []);

  return (
    <AuthProvider>
      <AppNavigator />
      <StatusBar style="dark" />
    </AuthProvider>
  );
}
