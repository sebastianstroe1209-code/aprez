'use client'

// Dashboard NOW zone (C6 P3-7).
// Renders the currently-active reservations — those whose backend status
// is Awaiting Guest or Occupied. Click on a row opens the shared
// ReservationDetailPopup (the parent owns the popup mount + onClick).
//
// Per memory/waiter_ux_strategy.md §3.8 row content:
//   time, guest name, table label, party size, status badge,
//   special-request icon, "X min late" badge if applicable.

import { useTranslations } from 'next-intl'

function MinLate({ secondsLate }) {
  const t = useTranslations()
  if (!secondsLate || secondsLate <= 600) return null
  const minutes = Math.floor(secondsLate / 60)
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-900 font-semibold leading-none whitespace-nowrap">
      {t('popup.minutesLate', { minutes })}
    </span>
  )
}

export default function NowZone({ items = [], onPick }) {
  const t = useTranslations()
  const sorted = [...items].sort((a, b) => (a.tableLabel || '').localeCompare(b.tableLabel || ''))

  return (
    <section className="bg-white rounded-lg shadow-sm p-4 sm:p-6 min-h-[200px]">
      <h2 className="text-lg font-bold text-gray-900 mb-3">{t('dashboard.now.title')}</h2>
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500 italic">
          {t('dashboard.now.empty')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sorted.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick?.(r)}
                className="w-full flex items-center gap-3 py-3 px-1 hover:bg-gray-50 rounded text-left min-h-[56px]"
              >
                <span className="text-sm font-mono tabular-nums w-12 shrink-0">{r.time || '—'}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium text-gray-900">
                    {r.guestName || '—'}
                    {r.hasSpecialRequests && (
                      <span className="text-amber-500 ml-1" aria-hidden="true">✦</span>
                    )}
                  </span>
                  <span className="text-xs text-gray-500">
                    {r.tableLabel ? `${r.tableLabel} · ` : ''}×{r.partySize ?? '—'}
                  </span>
                </span>
                <MinLate secondsLate={r.secondsLate} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
