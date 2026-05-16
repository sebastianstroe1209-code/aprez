'use client'

// Dashboard SEARCH zone (C6 P3-7).
// Debounced 300ms guest search against the existing
// /api/restaurant/reservations/search endpoint. Each result row shows
// the guest's name + contact + reservation details; click opens the
// shared ReservationDetailPopup. Empty input renders nothing.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiGet } from '../../lib/api'

function rowGuest(r) {
  if (r.guestName) return r.guestName
  if (r.user) return `${r.user.firstName || ''} ${r.user.lastName || ''}`.trim()
  return '—'
}

function rowContact(r) {
  const phone = r.guestPhone || r.user?.phone
  const email = r.guestEmail || r.user?.email
  return [phone, email].filter(Boolean).join(' · ')
}

function shortDate(iso) {
  if (!iso) return ''
  const s = typeof iso === 'string' ? iso : iso.toISOString?.()
  if (!s) return ''
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

export default function SearchZone({ onPick }) {
  const t = useTranslations()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // null = idle; [] = no matches; [...] = matches
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults(null); return }
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const data = await apiGet(`/api/restaurant/reservations/search?q=${encodeURIComponent(q)}`)
        setResults(Array.isArray(data) ? data : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [query])

  return (
    <section className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-3">{t('dashboard.search.title')}</h2>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('dashboard.search.placeholder')}
        className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
      />
      {query.trim() && results !== null && (
        <div className="mt-3">
          {results.length === 0 && !searching ? (
            <div className="py-6 text-center text-sm text-gray-500 italic">
              {t('dashboard.search.empty', { query: query.trim() })}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPick?.(r)}
                    className="w-full flex items-center gap-3 py-3 px-1 hover:bg-gray-50 rounded text-left min-h-[56px]"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium text-gray-900">{rowGuest(r)}</span>
                      <span className="block text-xs text-gray-500 truncate">{rowContact(r) || '—'}</span>
                    </span>
                    <span className="text-xs text-gray-500 text-right shrink-0">
                      {shortDate(r.date)}
                      <span className="block tabular-nums">{r.time} · ×{r.partySize}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
