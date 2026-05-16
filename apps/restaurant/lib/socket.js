'use client'

// Restaurant Platform Socket.IO client (Tier C4; audited C6 Phase 2).
// Single shared connection per browser tab. The JWT is read once at connect
// time; if it changes (logout/login), call resetSocket() to rebuild.
//
// Backend contract: memory/waiter_ux_strategy.md §5a (events) + §4.4
// (reconnect + page-focus refetch + reconnecting banner). Payload shapes
// for the seven events are documented in server/src/socket/events.md.
//
// ============================================
// PUBLIC API (stable — Phase 2/3 components depend on these)
// ============================================
//
//   getSocket()
//     Lazily build (or return) the singleton. Returns null in SSR; on the
//     client always returns a socket.io-client instance. Safe to call from
//     React effects — multiple calls reuse the same connection.
//
//   resetSocket()
//     Tear down the singleton (drops all listeners, disconnects). Call on
//     logout so the next login rebuilds with a fresh JWT handshake.
//
//   subscribe(event, handler) -> unsubscribe
//     Attach `handler(payload)` to one of the §5a events. Returns an
//     unsubscribe function suitable for useEffect cleanup. Multiple
//     subscribers to the same event are independent. Lazy-inits the socket
//     so callers don't need to mount getSocket() first.
//
//   subscribeStatus(handler) -> unsubscribe
//     Receive boolean connect/disconnect status. Fires once on subscribe
//     with the current state. Used by the ReconnectingBanner to debounce
//     short blips before showing the banner.
//
// Reconnect behavior (configured below): infinite retries, 500ms initial
// backoff up to 30s max, websocket-first with polling fallback. Per §4.4
// the client refetches the current page on (a) initial mount, (b) socket
// reconnect, (c) document visibilitychange→visible — that wiring lives in
// useSocketRefetch.js so individual pages can pass a stable `refetch` fn.
//
// Phase 3 note: the quiet-flag refetch pattern (commit 8497955) is
// duplicated across reservations/live/calendar pages — they each define
// `loadX(quiet)` with `setLoading(!quiet)` gating. Phase 3 consolidates
// this into the shared components.

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
