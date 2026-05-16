// Tier C5 i18n scaffold (mobile). i18next + react-i18next per SPEC §11.
// Locale persists in SecureStore (already a dep — avoids pulling in
// @react-native-async-storage/async-storage just for this). On login,
// AuthContext seeds the locale from User.preferredLanguage. setLocale()
// also syncs the choice to the backend.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import api from './api';
import ro from '../locales/ro.json';
import en from '../locales/en.json';

const SUPPORTED = ['ro', 'en'];
const STORAGE_KEY = 'aprez.locale';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ro: { translation: ro },
      en: { translation: en },
    },
    lng: 'ro', // SPEC §11: Romanian primary.
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export async function loadStoredLocale() {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) {
      await i18n.changeLanguage(stored);
    }
  } catch (e) { /* SecureStore unavailable; stick with default */ }
}

export async function setLocale(next, { syncBackend = true } = {}) {
  if (!SUPPORTED.includes(next)) return;
  await i18n.changeLanguage(next);
  try { await SecureStore.setItemAsync(STORAGE_KEY, next); } catch (e) { /* ignore */ }
  if (syncBackend) {
    try {
      await api.put('/users/me/language', { language: next });
    } catch (e) {
      // Don't block UX on backend sync — locale already changed locally.
      // Next login will re-seed from User.preferredLanguage anyway.
    }
  }
}

export function getCurrentLocale() {
  return i18n.language || 'ro';
}

export default i18n;
