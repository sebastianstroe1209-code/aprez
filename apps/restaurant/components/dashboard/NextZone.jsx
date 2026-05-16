'use client'

// Dashboard NEXT zone (C6 P3-7).
// Chronological list of upcoming PENDING/CONFIRMED/AUTO_CONFIRMED
// reservations from now forward. Backend returns 8 in the summary
// payload; "Show more" lazy-loads up to 24 via the existing
// /reservations endpoint (no backend change needed).

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiGet } from '../../lib/api'

const STATUS_TONE = {
  PENDING:        'bg-yellow-100 text-yellow-800',
  CONFIRMED:      'bg-green-100  text-green-800',
  AUTO_CONFIRMED: 'bg-green-100  text-green-800',
  AWAITING_GUEST: 'bg-pink-100   text-pink-900',
  OCCUPIED:       'bg-red-100    text-red-900',
}

function StatusBadge({ status }) {
  const t = useTranslations()
  const tone = STATUS_TONE[status] || 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${tone}`}>
      {t(`statusLabel.${status}`)}
    </span>
  )
}

// Format an ISO date into Romanian DD-MM-YYYY for the row's date column.
function shortDate(iso) {
  if (!iso) return ''
  const s = typeof iso === 'string' ? iso : iso.toISOString?.()
  if (!s) return ''
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

export default function NextZone({ items = [], onPick }) {
  const t = useTranslations()
  const [expanded, setExpanded] = useState(false)
  const [extra, setExtra] = useState(null) // null = not loaded; [] = loaded but empty
  const [loadingMore, setLoadingMore] = useState(false)

  const handleShowMore = useCallback(async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (extra !== null) return // already loaded
    setLoadingMore(true)
    try {
      // No date filter → /reservations returns from today onward (per
      // restaurantPlatform.routes.js line ~76 default behavior).
      const all = await apiGet('/api/restaurant/reservations')
      const seedIds = new Set(items.map((r) => r.id))
      const future = (all || [])
        .filter((r) => ['PENDING', 'CONFIRMED', 'AUTO_CONFIRMED'].includes(r.status))
        .filter((r) => !seedIds.has(r.id))
        .slice(0, 24 - items.length)
      setExtra(future)
    } catch {
      setExtra([])
    } finally {
      setLoadingMore(false)
    }
  }, [expanded, extra, items])

  const visible = expanded && extra ? [...items, ...extra] : items

  return (
    <section className="bg-white rounded-lg shadow-sm p-4 sm:p-6 min-h-[200px] flex flex-col">
      <h2 className="text-lg font-bold text-gray-900 mb-3">{t('dashboard.next.title')}</h2>
      {visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-8 text-center text-sm text-gray-500 italic">
          {t('dashboard.next.empty')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 flex-1">
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick?.(r)}
                className="w-full flex items-center gap-3 py-3 px-1 hover:bg-gray-50 rounded text-left min-h-[56px]"
              >
                <span className="text-sm font-mono tabular-nums w-12 shrink-0">{r.time || '—'}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium text-gray-900">
                    {r.guestName || (r.user ? `${r.user.firstName || ''} ${r.user.lastName || ''}`.trim() : '—')}
                    {r.hasSpecialRequests || (r.specialRequests && String(r.specialRequests).trim()) ? (
                      <span className="text-amber-500 ml-1" aria-hidden="true">✦</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-gray-500">
                    {r.tableLabel || (r.table?.tableNumber ? r.table.tableNumber : '')}
                    {(r.tableLabel || r.table?.tableNumber) && ' · '}
                    ×{r.partySize ?? '—'}
                    {r.date && ` · ${shortDate(r.date)}`}
                  </span>
                </span>
                <StatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length >= 8 && (
        <button
          type="button"
          onClick={handleShowMore}
          disabled={loadingMore}
          className="mt-3 self-start text-sm text-primary hover:underline disabled:opacity-60"
        >
          {loadingMore ? '…' : (expanded ? t('dashboard.next.showLess') : t('dashboard.next.showMore'))}
        </button>
      )}
    </section>
  )
}
