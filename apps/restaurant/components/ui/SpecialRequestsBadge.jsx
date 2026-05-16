'use client'

// Shared "✦" badge for reservations with non-empty specialRequests
// (C6 P3-9 §3.12). Single source-of-truth so the icon stays visually
// consistent on Reservations rows, Calendar block popups, Dashboard
// NOW/NEXT rows, Live overlay, and the ReservationDetailPopup header.
//
// Pass either:
//   <SpecialRequestsBadge hasSpecialRequests={true} />
//   <SpecialRequestsBadge specialRequests="anniversary" />
//
// If `specialRequests` text is provided, the browser-native tooltip
// (title attr) shows it on hover; tap reveals the same text on touch
// devices via the title's accessibility fallback. For a richer inline
// expansion (per the spec's "tap reveals full text"), the parent should
// render the full text in its own UI — this badge is intentionally tiny
// so it fits in dense rows.

import { useTranslations } from 'next-intl'

export default function SpecialRequestsBadge({ hasSpecialRequests, specialRequests, className = '' }) {
  const t = useTranslations()
  const present = hasSpecialRequests || !!(specialRequests && String(specialRequests).trim())
  if (!present) return null
  const tooltip = specialRequests && String(specialRequests).trim()
    ? String(specialRequests).trim()
    : t('popup.specialRequestsBadge')
  return (
    <span
      title={tooltip}
      aria-label={t('popup.specialRequestsBadge')}
      className={`text-amber-500 inline-block leading-none ${className}`}
    >
      ✦
    </span>
  )
}
