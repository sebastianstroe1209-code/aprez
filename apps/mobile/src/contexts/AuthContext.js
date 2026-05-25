import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import api, { getErrorMessage } from '../lib/api';
import { getSocket, resetSocket } from '../lib/socket';
import { setLocale as setI18nLocale } from '../lib/i18n';
import { registerPushToken } from '../lib/pushNotifications';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check for existing session on app launch
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await SecureStore.getItemAsync('userToken');
      if (token) {
        const res = await api.get('/users/me');
        setUser(res.data);
        // J1b — cold-start push-token re-check: catches the diner who
        // granted notification permission via system Settings without
        // re-logging-in, plus token rotation. Fire-and-forget.
        registerPushToken();
        // C4: spin up the socket once we know the user is authenticated so
        // §5a events arrive on user:{id}.
        getSocket().catch(() => {});
        // C5: seed the i18n locale from server's preferredLanguage so the
        // mobile app matches what the dispatcher uses for notification
        // templates. Skip the backend round-trip — the server already
        // authoritative.
        if (res.data?.preferredLanguage) {
          setI18nLocale(res.data.preferredLanguage, { syncBackend: false }).catch(() => {});
        }
      }
    } catch (e) {
      await SecureStore.deleteItemAsync('userToken').catch(() => {});
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      setError(null);
      const res = await api.post('/auth/login', { email, password });
      await SecureStore.setItemAsync('userToken', res.data.token);
      setUser(res.data.user);
      // Rebuild the socket so the handshake picks up the new token.
      resetSocket();
      getSocket().catch(() => {});
      // J1b — register/refresh the Expo push token. Fire-and-forget,
      // fully self-guarded; never blocks or fails login.
      registerPushToken();
      return true;
    } catch (e) {
      setError(getErrorMessage(e));
      return false;
    }
  };

  const register = async ({ firstName, lastName, email, password, phone }) => {
    try {
      setError(null);
      const res = await api.post('/auth/register', {
        firstName,
        lastName,
        email,
        password,
        phone: phone || undefined,
      });
      await SecureStore.setItemAsync('userToken', res.data.token);
      setUser(res.data.user);
      resetSocket();
      getSocket().catch(() => {});
      // J1b — register the Expo push token for the new account.
      registerPushToken();
      return true;
    } catch (e) {
      setError(getErrorMessage(e));
      return false;
    }
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('userToken').catch(() => {});
    // J3 launch-fix: also clear the push-token cache so the next login
    // (potentially a different user on the same device) re-uploads its
    // token to the new user record. iOS Keychain items survive app
    // uninstall, so without this a stale cache from a previous user can
    // prevent the new user from ever getting a push token registered.
    await SecureStore.deleteItemAsync('aprez.expoPushToken').catch(() => {});
    resetSocket();
    setUser(null);
  };

  const updateProfile = async (data) => {
    try {
      setError(null);
      // Pre-D2 this called `/users/profile` which doesn't exist on the
      // server (404). The real endpoint is `/users/me` — fix bundled with
      // Tier D commit 2 because the new phone-collection prompt needs the
      // same path to add a phone post-booking.
      const res = await api.put('/users/me', data);
      setUser((prev) => ({ ...(prev || {}), ...res.data }));
      return true;
    } catch (e) {
      setError(getErrorMessage(e));
      return false;
    }
  };

  // Re-pull /users/me into the context after a server-side change made
  // outside the AuthContext (e.g. inline phone-prompt PUT). Cheaper than
  // duplicating field-merge logic in every caller.
  const refreshUser = async () => {
    try {
      const res = await api.get('/users/me');
      setUser(res.data);
      return res.data;
    } catch (e) {
      return null;
    }
  };

  // GDPR §5.9 — wired in Tier D commit 2. The server soft-deletes + sets
  // deletedAt, after which any further request with this token returns 401
  // 'account-deleted'. We clear local state immediately so the UI bounces
  // to the auth stack without waiting for the next 401.
  //
  // K5 — server now requires password re-auth as a second factor (a
  // stolen JWT alone can no longer wipe an account). Returns
  // { ok:true } on success, { ok:false, code } on failure where `code`
  // is the server's structured error.code ('password-required' /
  // 'password-incorrect') or null (network / other). The caller maps
  // the code to localized copy.
  const deleteAccount = async (password) => {
    try {
      setError(null);
      // axios DELETE with body uses `data` option, not the 2nd arg.
      await api.delete('/users/me', { data: { password } });
      await SecureStore.deleteItemAsync('userToken').catch(() => {});
      resetSocket();
      setUser(null);
      return { ok: true };
    } catch (e) {
      const code = e?.response?.data?.error?.code || null;
      setError(getErrorMessage(e));
      return { ok: false, code };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        setError,
        login,
        register,
        logout,
        updateProfile,
        refreshUser,
        deleteAccount,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
