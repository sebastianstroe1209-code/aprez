'use client'

// Shared context for the pending-reservation count + the reservations
// page's currently active tab (used by PendingReservationListener to
// decide whether to suppress the toast).
//
// Two contexts in one file because they're tightly coupled by C6 §3.6
// behavior. Both providers wrap the dashboard layout.

import { createContext, useCallback, useContext, useState } from 'react'

// -----------------------------------------------------------------------
// PendingCount — total pending-confirmation count across the restaurant.
// Initialized from /api/restaurant/dashboard/summary on listener mount
// and reset on socket reconnect / page-focus refetch. Increments on
// reservation:pending-created, decrements when staff confirms/rejects.
// -----------------------------------------------------------------------

const PendingCountCtx = createContext({
  count: 0,
  setCount: () => {},
  increment: () => {},
  decrement: () => {},
})

export function usePendingCount() {
  return useContext(PendingCountCtx)
}

export function PendingCountProvider({ children }) {
  const [count, setCount] = useState(0)
  const increment = useCallback(() => setCount((n) => n + 1), [])
  const decrement = useCallback(() => setCount((n) => Math.max(0, n - 1)), [])
  return (
    <PendingCountCtx.Provider value={{ count, setCount, increment, decrement }}>
      {children}
    </PendingCountCtx.Provider>
  )
}

// -----------------------------------------------------------------------
// ReservationsTab — the active tab on /dashboard/reservations. The page
// publishes its current tab into this context (via useEffect on the local
// `tab` state); the pending listener reads it to decide suppression per
// §3.6 ("suppress toast if user is already on the Pending tab").
//
// Default `null` means "no reservations page mounted" → never suppress.
// -----------------------------------------------------------------------

const ReservationsTabCtx = createContext({
  activeTab: null,        // 'all' | 'pending' | 'today' | null
  setActiveTab: () => {},
})

export function useReservationsTab() {
  return useContext(ReservationsTabCtx)
}

export function ReservationsTabProvider({ children }) {
  const [activeTab, setActiveTab] = useState(null)
  return (
    <ReservationsTabCtx.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </ReservationsTabCtx.Provider>
  )
}
