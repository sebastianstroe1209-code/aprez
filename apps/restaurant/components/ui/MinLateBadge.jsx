'use client'

// Shared "X min late" pill (C6 P3-9 §3.13). Single threshold
// (secondsLate > 600) and single visual treatment across the
// Reservations page rows, Calendar block popup, Dashboard NOW zone,
// Live overlay, and ReservationDetailPopup header.
//
// Pass `secondsLate` (the value the backend computes on
// /api/restaurant/layout/live and /api/restaurant/dashboard/summary
// per C6 Phase 1). Renders nothing under the 10-minute threshold.

import { useTranslations } from 'next-intl'

export default function MinLateBadge({ secondsLate, className = '' }) {
  const t = useTranslations()
  if (!secondsLate || secondsLate <= 600) return null
  const minutes = Math.floor(secondsLate / 60)
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-900 text-[10px] font-semibold leading-none whitespace-nowrap ${className}`}
    >
      {t('popup.minutesLate', { minutes })}
    </span>
  )
}
