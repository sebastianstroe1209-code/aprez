'use client'

// Toast / notification provider (C6 Phase 2 shared infrastructure).
// Per memory/waiter_ux_strategy.md §3.5 (no-show undo), §3.6 (pending alert),
// and §4.3 (undo pattern for low-stakes destructive actions).
//
// Usage:
//   const { show } = useToast()
//   show('Reservation saved', { variant: 'success' })
//   show('Marked no-show — Smith ×4', {
//     variant: 'undo',
//     actionLabel: t('toast.undoLabel'),
//     onAction: () => revert(),
//     durationMs: 10000,
//   })
//
// Stack: max 3 visible (oldest dropped when 4th arrives).
// Auto-dismiss: durationMs after show; default 8000ms.
// Tap-to-dismiss: clicking the toast body dismisses it.
// Position: top-right on tablet/desktop (≥640px); top-center stretched on phone.

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import Toast from './Toast'

const ToastContext = createContext({ show: () => 0 })

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 1
const MAX_VISIBLE = 3

export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  // Keep timer handles so dismiss-on-click can clear pending auto-dismiss.
  const timersRef = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
    const handle = timersRef.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timersRef.current.delete(id)
    }
  }, [])

  const show = useCallback((message, opts = {}) => {
    const id = nextId++
    const durationMs = opts.durationMs ?? 8000
    const toast = {
      id,
      message,
      variant: opts.variant || 'info',
      actionLabel: opts.actionLabel,
      onAction: opts.onAction,
    }
    setToasts((ts) => {
      const next = [...ts, toast]
      // Drop oldest if exceeding max visible. The cap is per spec §3.6
      // (max 3 visible pending toasts, oldest first).
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
    })
    if (durationMs > 0) {
      const handle = setTimeout(() => dismiss(id), durationMs)
      timersRef.current.set(id, handle)
    }
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <div
        role="region"
        aria-live="polite"
        className="fixed z-[60] top-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <Toast
            key={t.id}
            id={t.id}
            message={t.message}
            variant={t.variant}
            actionLabel={t.actionLabel}
            onAction={t.onAction}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
