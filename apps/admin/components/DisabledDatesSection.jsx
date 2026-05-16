'use client'

// Tier F commit 2 — Disabled Days section for the admin restaurant edit
// page. Lets admins block specific dates (private events, closures,
// holidays) so diners can't book them. Backed by GET/POST/DELETE
// /api/admin/restaurants/:id/disabled-dates and enforced server-side
// in /api/reservations + /api/restaurants/:id/time-slots.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiGet, apiPost, apiDelete } from '../lib/api'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function formatDisplay(iso) {
  // The list endpoint returns full ISO timestamps; strip to date and
  // format DD-MM-YYYY per SPEC §11 locale rule.
  const datePart = (iso || '').slice(0, 10)
  const [y, m, d] = datePart.split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

export default function DisabledDatesSection({ restaurantId }) {
  const t = useTranslations('disabledDates')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    try {
      const data = await apiGet(`/api/admin/restaurants/${restaurantId}/disabled-dates`)
      setRows(data || [])
    } catch (e) {
      setError(e.message || t('errorLoad'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [restaurantId])

  const handleAdd = async () => {
    if (saving || !date) return
    setError('')
    setSaving(true)
    try {
      const created = await apiPost(`/api/admin/restaurants/${restaurantId}/disabled-dates`, {
        date,
        reason: reason.trim() || undefined,
      })
      setRows((prev) => [...prev, created].sort((a, b) => (a.date < b.date ? -1 : 1)))
      setDate('')
      setReason('')
    } catch (err) {
      const msg = err.message || ''
      if (/already-exists/.test(msg)) setError(t('errorAlreadyExists'))
      else if (/date-in-past/.test(msg) || /past/i.test(msg)) setError(t('errorPast'))
      else setError(err.message || t('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  // Tier F2 fix-the-fix (2026-05-16): the section used to wrap its
  // inputs in a nested <form onSubmit={handleAdd}>, which is invalid
  // HTML (nested forms collapse in some browsers) and caused the Add
  // button to submit the *parent* EditRestaurantPage form rather than
  // calling this handler — the disabled date never persisted. The form
  // wrapper is gone now (replaced with a <div>); this keyboard handler
  // preserves the "press Enter to submit" ergonomic without re-bubbling
  // Enter up to the outer form.
  const stopEnter = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    handleAdd()
  }

  const handleRemove = async (id) => {
    if (!confirm(t('removeConfirm'))) return
    setError('')
    try {
      await apiDelete(`/api/admin/restaurants/${restaurantId}/disabled-dates/${id}`)
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setError(err.message || t('errorGeneric'))
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-2">{t('sectionTitle')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('sectionHint')}</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {/* NOT a <form> — see comment above stopEnter. This component is
          rendered inside the parent EditRestaurantPage <form>, and nested
          forms misbehave (the parent steals the submit). The Add button
          is type="button" and the inputs handle Enter explicitly. */}
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-3 items-end mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('dateLabel')}</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={stopEnter}
            min={todayIso()}
            disabled={saving}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('reasonLabel')}</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={stopEnter}
            placeholder={t('reasonPlaceholder')}
            maxLength={200}
            disabled={saving}
            className="w-full"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !date}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-dark disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
        >
          {saving ? t('saving') : t('addButton')}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">{t('loading')}</div>
      ) : rows.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center text-sm text-gray-500">
          {t('empty')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800">{formatDisplay(row.date)}</div>
                {row.reason ? (
                  <div className="text-xs text-gray-500 truncate">{row.reason}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(row.id)}
                aria-label={t('removeButton')}
                className="ml-3 text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50 text-sm font-medium"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
