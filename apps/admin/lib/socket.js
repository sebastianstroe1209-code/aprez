'use client'

// Admin Socket.IO client (Tier C4). Admins join admin:global on the server
// via the JWT handshake; they receive `reservation:pending-created` and
// `reservation:updated` for cross-restaurant monitoring.
// Backend contract: memory/waiter_ux_strategy.md §5a.

import { io } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:4000'

let socket = null
const statusListeners = new Set()

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
  const token = localStorage.getItem('adminToken')
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
  notifyStatus(false)
}

export function subscribe(event, handler) {
  const s = getSocket()
  if (!s) return () => {}
  s.on(event, handler)
  return () => s.off(event, handler)
}

export function subscribeStatus(handler) {
  statusListeners.add(handler)
  const s = getSocket()
  if (s) handler(s.connected)
  return () => statusListeners.delete(handler)
}
