'use client'

// Floating Quick Add trigger (C6 Phase 3 item 1).
// Per memory/waiter_ux_strategy.md §3.2: a "+" button visible bottom-right
// on Dashboard, Live, Reservations, Calendar (NOT Settings — Settings is
// not a service-time page), plus the Alt+N keyboard shortcut.
//
// Self-contained: owns its own modal-open state, mounts QuickAddReservation,
// listens for Alt+N globally, and wires the success toast via useToast.
// Mounted once in the dashboard layout so it follows the user across pages.

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import QuickAddReservation from '../QuickAddReservation'
import { useToast } from './ToastProvider'

// Match the literal /dashboard/settings page and any future child routes
// under it. Other dashboard pages all get the button.
function isHiddenPath(pathname) {
  if (!pathname) return false
  return pathname === '/dashboard/settings' || pathname.startsWith('/dashboard/settings/')
}

// Don't fire Alt+N when the user is typing into a text input — otherwise
// pressing "Alt+N" while typing a guest name would steal the keystroke.
// Covers <input>, <textarea>, and contenteditable elements.
function isTypingTarget(target) {
  if (!target) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export default function QuickAddButton() {
  const t = useTranslations()
  const pathname = usePathname()
  const { show } = useToast()
  const [open, setOpen] = useState(false)

  const hidden = isHiddenPath(pathname)

  // Alt+N global shortcut. Listener stays mounted across all dashboard
  // pages (the layout that hosts this component doesn't unmount on
  // route changes within /dashboard), so a single keydown attach is
  // sufficient. Re-checks `hidden` at fire-time so the shortcut goes
  // dead on Settings without needing a remount.
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        if (hidden) return
        if (isTypingTarget(e.target)) return
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidden])

  const handleSaved = useCallback((saved) => {
    const name = saved?.guestName || saved?.user?.firstName || ''
    show(t('quickAdd.toast.created', { name }), {
      variant: 'success',
      durationMs: 4000,
    })
  }, [show, t])

  if (hidden) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('quickAdd.button.label')}
        title={t('quickAdd.button.tooltip')}
        // Bottom-right, above page content (z-40) but below modals (z-50)
        // and toasts (z-60). 56px round-ish target on phone keeps it
        // thumb-reachable; expands to a label-bearing pill at sm+.
        className="fixed bottom-6 right-6 z-40 bg-primary hover:bg-primary-dark text-white shadow-lg rounded-full px-5 py-3 min-h-[56px] font-semibold text-base flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {/* Label hidden on the tiniest phone widths to keep the FAB
            circular; visible from sm+ so the action is self-describing. */}
        <span className="hidden sm:inline">{t('quickAdd.button.label')}</span>
      </button>
      <QuickAddReservation
        isOpen={open}
        onClose={() => setOpen(false)}
        onSaveSuccess={handleSaved}
      />
    </>
  )
}
