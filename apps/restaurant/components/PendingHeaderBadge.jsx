'use client'

// Persistent pending-confirmation count badge in the dashboard top header
// (C6 P3-2 §3.6). Renders nothing when count === 0; otherwise a small
// amber pill. Clicking navigates to the Reservations Pending tab.
// Lives in the layout header so it's visible on EVERY dashboard page —
// including Settings — per the §3.6 cross-cutting requirement.

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { usePendingCount } from '../lib/pendingContext'

export default function PendingHeaderBadge() {
  const t = useTranslations()
  const router = useRouter()
  const { count } = usePendingCount()
  if (!count || count <= 0) return null

  return (
    <button
      type="button"
      onClick={() => router.push('/dashboard/reservations?tab=pending')}
      title={t('pending.badge.tooltip', { count })}
      aria-label={t('pending.badge.tooltip', { count })}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-semibold text-sm min-h-[40px] transition-colors"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
      <span>{count}</span>
      <span className="hidden sm:inline text-xs font-normal">
        {t('pending.badge.tooltip', { count })}
      </span>
    </button>
  )
}
