// Mobile diner Socket.IO client (Tier C4). Subscribes to events emitted to
// the diner's user:{id} room: reservation:updated and reservation:cancelled.
// Backend contract: memory/waiter_ux_strategy.md §5a + §4.4.

import { io } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { DEV_API_HOST } from './devHost';

// Same host as api.js — socket.io connects to the bare host (no /api
// suffix). Dev host lives in devHost.js (the single source shared with
// api.js, so the two never drift).
const SOCKET_URL = __DEV__
  ? DEV_API_HOST
  : 'https://aprez-server.onrender.com';

let socket = null;
const statusListeners = new Set();

function notifyStatus(connected) {
  for (const fn of statusListeners) {
    try { fn(connected); } catch (e) { /* swallow */ }
  }
}

async function buildSocket() {
  let token = null;
  try {
    token = await SecureStore.getItemAsync('userToken');
  } catch (e) { /* SecureStore unavailable; continue tokenless */ }

  const s = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
  });
  s.on('connect', () => notifyStatus(true));
  s.on('disconnect', () => notifyStatus(false));
  s.on('connect_error', () => notifyStatus(false));
  return s;
}

// Async because we need to read the token from SecureStore. Callers await
// once; subsequent calls return the cached singleton.
export async function getSocket() {
  if (socket) return socket;
  socket = await buildSocket();
  return socket;
}

export function getSocketSync() {
  return socket;
}

export function resetSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  notifyStatus(false);
}

export async function subscribe(event, handler) {
  const s = await getSocket();
  s.on(event, handler);
  return () => s.off(event, handler);
}

export function subscribeStatus(handler) {
  statusListeners.add(handler);
  if (socket) handler(socket.connected);
  return () => statusListeners.delete(handler);
}
