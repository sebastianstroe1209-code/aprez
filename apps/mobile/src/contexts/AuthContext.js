import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import api, { getErrorMessage } from '../lib/api';
import { getSocket, resetSocket } from '../lib/socket';
import { setLocale as setI18nLocale } from '../lib/i18n';

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
      return true;
    } catch (e) {
      setError(getErrorMessage(e));
      return false;
    }
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('userToken').catch(() => {});
    resetSocket();
    setUser(null);
  };

  const updateProfile = async (data) => {
    try {
      setError(null);
      const res = await api.put('/users/profile', data);
      setUser(res.data);
      return true;
    } catch (e) {
      setError(getErrorMessage(e));
      return false;
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
