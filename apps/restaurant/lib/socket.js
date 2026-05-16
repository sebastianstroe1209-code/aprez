'use client'

// Restaurant Platform Socket.IO client (Tier C4).
// Single shared connection per browser tab. The JWT is read once at connect
// time; if it changes (logout/login), call resetSocket() to rebuild.
//
// Backend contract: memory/waiter_ux_strategy.md §5a (events) + §4.4
// (reconnect + page-focus refetch + reconnecting banner).

import { io } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:4000'

let socket = null
const statusListeners = new Set() // (connected: boolean) => void
const eventListeners = new Map()  // event -> Set<handler>

function notifyStatus(connected) {
  for (const fn of statusListeners) {
    try { fn(connected) } catch (e) { /* swallow */ }
  }
}

function attachInternalListeners(s) {
  s.on('connect', () => notifyStatus(true))
  s.on('disconnect', () => notifyStatus(false))
  s.on('connect_error', () => notifyStatus(false))
}

export function getSocket() {
  if (socket) return socket
  if (typeof window === 'undefined') return null

  const token = localStorage.getItem('restaurantToken')
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
  })
  attachInternalListeners(socket)
  return socket
}

export function resetSocket() {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  eventListeners.clear()
  notifyStatus(false)
}

// React-friendly subscription wrappers. `subscribe(event, handler)` returns an
// unsubscribe fn so components can wire/unwire in useEffect cleanups.
export function subscribe(event, handler) {
  const s = getSocket()
  if (!s) return () => {}
  if (!eventListeners.has(event)) eventListeners.set(event, new Set())
  eventListeners.get(event).add(handler)
  s.on(event, handler)
  return () => {
    s.off(event, handler)
    eventListeners.get(event)?.delete(handler)
  }
}

export function subscribeStatus(handler) {
  statusListeners.add(handler)
  const s = getSocket()
  if (s) handler(s.connected)
  return () => statusListeners.delete(handler)
}
