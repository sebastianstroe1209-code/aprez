'use client'

// C6 P3-2: pending reservation real-time alert.
// Per memory/waiter_ux_strategy.md §3.6 — toast + badge increment + audio
// chime on the reservation:pending-created socket event. Mounted at the
// dashboard layout level so the alert fires regardless of which page the
// waiter is currently on.
//
// Suppression: if the user is on /dashboard/reservations with the Pending
// tab active, the badge still increments but the toast is suppressed
// (they're already looking at the list).
//
// Audio chime requires a one-time user gesture per browser autoplay
// policy. We render a soft inline consent prompt at the top of the layout
// when (a) audio is enabled in localStorage and (b) consent hasn't been
// granted yet. The prompt auto-dismisses on the first document-level
// click anywhere and primes the AudioContext on the same gesture.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { subscribe } from '../lib/socket'
import { useSocketRefetch } from '../lib/useSocketRefetch'
import { apiGet } from '../lib/api'
import { useToast } from './ui/ToastProvider'
import { usePendingCount, useReservationsTab } from '../lib/pendingContext'
import { isAudioEnabled, hasAudioConsent, markAudioConsent, playPing } from '../lib/audio'

function formatDateDDMMYYYY(d) {
  // SPEC §11 display: DD-MM-YYYY. Tolerates ISO string or Date object.
  const date = typeof d === 'string' ? new Date(d) : d
  if (!date || isNaN(date.getTime())) return ''
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()
  return `${day}-${month}-${year}`
}

function guestNameOf(p) {
  if (!p) return ''
  if (p.guestName) return p.guestName
  const u = p.user
  if (u) return [u.firstName, u.lastName].filter(Boolean).join(' ')
  return ''
}

export default function PendingReservationListener() {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const { show } = useToast()
  const { count, setCount, increment } = usePendingCount()
  const { activeTab } = useReservationsTab()
  const [consentPromptVisible, setConsentPromptVisible] = useState(false)

  // Seed the count from the server. Refetch via the standard §4.4 refetch
  // hook (initial mount + socket reconnect + tab focus). On error keep
  // whatever count we have — a stale count is better than a 0 surprise.
  const refetchCount = useCallback(() => {
    apiGet('/api/restaurant/dashboard/summary')
      .then((data) => {
        if (typeof data?.pendingConfirmationCount === 'number') {
          setCount(data.pendingConfirmationCount)
        }
      })
      .catch(() => { /* silent */ })
  }, [setCount])

  useEffect(() => { refetchCount() }, [refetchCount])
  useSocketRefetch(refetchCount)

  // Subscribe to reservation:pending-created. The handler captures the
  // CURRENT pathname/activeTab via closure (stable, re-bound on change).
  useEffect(() => {
    const handler = (payload) => {
      if (!payload) return
      // Always increment the badge so the count stays accurate even when
      // the toast is suppressed.
      increment()
      // Suppress toast when the user is already on the Pending tab.
      const onPendingTab =
        pathname === '/dashboard/reservations' && activeTab === 'pending'
      if (onPendingTab) return

      const guestName = guestNameOf(payload) || '—'
      const message = t('pending.toast.message', {
        guestName,
        date: formatDateDDMMYYYY(payload.date),
        time: payload.time || '',
        partySize: payload.partySize || 0,
      })
      show(message, {
        variant: 'info',
        durationMs: 8000,
        actionLabel: t('pending.toast.review'),
        onAction: () => {
          router.push(`/dashboard/reservations?focus=${payload.id}&tab=pending`)
        },
      })
      // Audio chime (only when not suppressed).
      if (isAudioEnabled() && hasAudioConsent()) playPing()
    }
    const unsub = subscribe('reservation:pending-created', handler)
    return () => unsub()
  }, [pathname, activeTab, increment, show, t, router])

  // One-time audio consent: show prompt only if audio is on AND consent
  // hasn't been granted. Click anywhere dismisses + primes the
  // AudioContext on the same user-gesture frame.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isAudioEnabled() || hasAudioConsent()) return
    setConsentPromptVisible(true)
    const onClick = () => {
      markAudioConsent()
      setConsentPromptVisible(false)
      document.removeEventListener('click', onClick, true)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  if (!consentPromptVisible) return null
  // Tiny consent banner — sits just below the Reconnecting banner if
  // both are visible (z-index 40 vs banner's z-50). Phone-friendly:
  // spans full width minus sidebar at ≥md.
  return (
    <div className="fixed top-10 left-0 md:left-64 right-0 z-40 bg-blue-50 border-b border-blue-200 text-blue-900 px-4 py-2 text-xs text-center">
      {t('pending.audio.consent')}
    </div>
  )
}
