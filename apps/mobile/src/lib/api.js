import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { DEV_API_HOST } from './devHost';

// Dev host (the laptop's LAN IP) lives in devHost.js — the single
// source so api.js and socket.js never drift. Prod hits the deployed API.
const API_BASE = __DEV__
  ? `${DEV_API_HOST}/api`
  : 'https://aprez-server.onrender.com/api';

// Tier F commit 1 — for /uploads/* paths (photos + menus). The DB
// stores relative paths like `/uploads/{rid}/photos/{file}.jpg`; the
// helper prepends the API host without the `/api` suffix so the Express
// static mount serves the file.
const MEDIA_ROOT = API_BASE.replace(/\/api\/?$/, '');
export function mediaUrl(relPath) {
  if (!relPath) return null;
  if (/^https?:\/\//.test(relPath)) return relPath;
  return `${MEDIA_ROOT}${relPath}`;
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach token to every request
api.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // SecureStore not available (web)
  }
  return config;
});

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('userToken').catch(() => {});
    }
    return Promise.reject(error);
  }
);

export default api;

// Helper to get user-friendly error messages.
// Backend's error envelope is `{ error: { message: '...', code?, ... } }` —
// an OBJECT, not a string. Pre-fix this returned the object directly and
// any `<Text>{error}</Text>` consumer crashed RN with "Objects are not
// valid as a React child". Always coerce to a string before returning.
export function getErrorMessage(error) {
  const e = error.response?.data?.error;
  if (e) {
    if (typeof e === 'string') return e;
    if (e.message && typeof e.message === 'string') return e.message;
    if (e.code && typeof e.code === 'string') return e.code;
    return 'Something went wrong';
  }
  if (error.response?.data?.errors) {
    return error.response.data.errors.map((e) => e.msg || e.message).join(', ');
  }
  if (error.message === 'Network Error') return 'No internet connection';
  return error.message || 'Something went wrong';
}
