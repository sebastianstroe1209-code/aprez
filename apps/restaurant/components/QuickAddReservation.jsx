'use client'

// Quick Add Reservation form (C6 Phase 2).
// Per memory/waiter_ux_strategy.md §3.2 (always-accessible trigger — owned
// by the parent) and §3.3 (the form behavior, this component). §4.2 covers
// the pending-sync save pattern.
//
// Props:
//   isOpen: boolean
//   onClose: () => void
//   prefill?: { date, time, tableId } — used by §3.10 click-empty-slot.
//   onSaveSuccess?: (savedReservation) => void — optional. When provided
//     the parent owns the post-save feedback (toast copy, follow-up nav,
//     etc.) and this component skips its built-in default toast. The
//     callback receives the POST response body. Callers that omit it
//     fall back to the component's built-in default `savedToast`.
//
// Smart defaults per §3.3 EDGE CASES:
//   - Date: today if open + time still in service window, else next open day
//     iterating up to 14 days through opening_hours.
//   - Time: next round 30-min slot in Europe/Bucharest, OR the day's first
//     opening slot if defaulting to a future day or past the last slot.
//   - Party size: 2.
//
// Live availability hint: GET /api/restaurant/availability with 300ms
// debounce on Date/Time/Party changes. Hidden silently if the endpoint is
// slow or errors (never blocks save).
//
// Closed-hours warning: if Date+Time is outside opening_hours, show inline
// warning before Save; doesn't block (staff override per §9.5 trust model).
//
// Pending-sync save: spinner + locked form during POST, toast + close on
// 200, inline error on failure, 10s timeout fallback shows retry.
//
// Responsive: full-screen bottom sheet at <768px, centered 560px at ≥768px.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiGet, apiPost } from '../lib/api'
import { useToast } from './ui/ToastProvider'

function nowBucharest() {
  const d = new Date()
  const date = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return { date, time }
}

function addDaysISO(dateISO, days) {
  const d = new Date(`${dateISO}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Schema dayOfWeek: 0=Mon..6=Sun. JS getUTCDay: 0=Sun..6=Sat. Convert.
function schemaDayOfWeek(dateISO) {
  const jsDay = new Date(`${dateISO}T00:00:00.000Z`).getUTCDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

function nextHalfHourSlot(hm) {
  const [h, m] = hm.split(':').map(Number)
  let totalMin = h * 60 + m
  const remainder = totalMin % 30
  if (remainder === 0) totalMin += 30
  else totalMin += 30 - remainder
  const nh = Math.floor(totalMin / 60) % 24
  const nm = totalMin % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

// Find the next date+time within the restaurant's opening_hours that's at
// least 30 minutes from now (SPEC §5.3 same-day lead time).
function computeSmartDefaults(profile) {
  const openingHours = profile?.openingHours || []
  const byDay = new Map()
  for (const oh of openingHours) {
    if (oh.isOpen) byDay.set(oh.dayOfWeek, oh)
  }
  const { date: today, time: now } = nowBucharest()
  const minSlot = nextHalfHourSlot(now)

  // Try today first if open and minSlot is within hours.
  const todayDow = schemaDayOfWeek(today)
  const todayOh = byDay.get(todayDow)
  if (todayOh && minSlot >= todayOh.openTime && minSlot < todayOh.closeTime) {
    return { date: today, time: minSlot, partySize: 2 }
  }
  // Walk forward up to 14 days to find the next open day.
  for (let i = 1; i <= 14; i++) {
    const candidate = addDaysISO(today, i)
    const oh = byDay.get(schemaDayOfWeek(candidate))
    if (oh) return { date: candidate, time: oh.openTime, partySize: 2 }
  }
  // Strategy fallback: first day of next month, no time pre-filled.
  const fallback = addDaysISO(today, 30)
  return { date: fallback, time: '19:00', partySize: 2 }
}

function isWithinAnyServicePeriod(profile, time) {
  const periods = profile?.servicePeriods || []
  if (periods.length === 0) return true // no periods configured → don't warn
  for (const p of periods) {
    if (time >= p.startTime && time < p.endTime) return true
  }
  return false
}

export default function QuickAddReservation({ isOpen, onClose, prefill, onSaveSuccess }) {
  const t = useTranslations()
  const { show: showToast } = useToast()
  const nameInputRef = useRef(null)
  const abortRef = useRef(null)

  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({
    guestName: '',
    guestPhone: '',
    date: prefill?.date || '',
    time: prefill?.time || '',
    partySize: '2',
    specialRequests: '',
  })
  // C6 P3-8 §3.10: when Quick Add is opened from a calendar empty-slot
  // click, the cell's tableId is prefilled. Posted to the backend so the
  // reservation lands on that table; the waiter can clear the assignment
  // with the badge's × to fall back to the unassigned-AutoConfirmed path
  // (§9.5). No full table-picker per §3.3 (Quick Add stays form-light).
  const [prefilledTableId, setPrefilledTableId] = useState(prefill?.tableId || null)
  const [prefilledTableLabel, setPrefilledTableLabel] = useState(prefill?.tableLabel || null)
  const [availability, setAvailability] = useState(null)
  const [closedHoursAck, setClosedHoursAck] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)

  // Fetch profile once on open so we can compute smart defaults.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    apiGet('/api/restaurant/profile')
      .then((p) => {
        if (cancelled) return
        setProfile(p)
        // Only set smart defaults if no prefill provided.
        setForm((prev) => {
          if (prev.date && prev.time) return prev
          const smart = computeSmartDefaults(p)
          return {
            ...prev,
            date: prev.date || smart.date,
            time: prev.time || smart.time,
            partySize: prev.partySize || String(smart.partySize),
          }
        })
      })
      .catch(() => { /* leave defaults blank; user fills manually */ })
    return () => { cancelled = true }
  }, [isOpen])

  // Autofocus on open.
  useEffect(() => {
    if (isOpen && nameInputRef.current) {
      const handle = setTimeout(() => nameInputRef.current.focus(), 50)
      return () => clearTimeout(handle)
    }
  }, [isOpen])

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Reset transient state when opened. Also re-seed the prefill table
  // tracking so re-opening from a different calendar cell picks up
  // the new prefill without stale state from the previous open.
  useEffect(() => {
    if (isOpen) {
      setError('')
      setTimedOut(false)
      setClosedHoursAck(false)
      setPrefilledTableId(prefill?.tableId || null)
      setPrefilledTableLabel(prefill?.tableLabel || null)
    }
  }, [isOpen, prefill?.tableId, prefill?.tableLabel])

  // Live availability hint (debounced 300ms).
  const availabilityDeps = `${form.date}|${form.time}|${form.partySize}`
  useEffect(() => {
    if (!isOpen) return
    if (!form.date || !form.time || !form.partySize) {
      setAvailability(null)
      return
    }
    const handle = setTimeout(async () => {
      try {
        const data = await apiGet(
          `/api/restaurant/availability?date=${encodeURIComponent(form.date)}` +
          `&time=${encodeURIComponent(form.time)}` +
          `&partySize=${encodeURIComponent(form.partySize)}`
        )
        setAvailability(data)
      } catch {
        setAvailability(null) // silent — never block save
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [availabilityDeps, isOpen])

  const isOutsideServicePeriods = useMemo(() => {
    return profile && form.time && !isWithinAnyServicePeriod(profile, form.time)
  }, [profile, form.time])

  const handleField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault()
    if (saving) return

    // Closed-hours gate: if outside service periods AND user hasn't ack'd,
    // surface the warning. The visible <ClosedHoursWarning /> block below
    // turns the Save click into the ack confirmation.
    if (isOutsideServicePeriods && !closedHoursAck) {
      setError('') // clear other errors; warning UI takes over
      return
    }

    setSaving(true)
    setError('')
    setTimedOut(false)

    // 10s pending-sync timeout per §4.2.
    const timeoutHandle = setTimeout(() => { setTimedOut(true) }, 10000)

    try {
      const body = {
        guestName: form.guestName.trim(),
        guestPhone: form.guestPhone.trim() || '—',
        date: form.date,
        time: form.time,
        partySize: parseInt(form.partySize),
      }
      if (form.specialRequests.trim()) body.specialRequests = form.specialRequests.trim()
      if (prefilledTableId) body.tableId = prefilledTableId
      const saved = await apiPost('/api/restaurant/reservations', body)
      if (onSaveSuccess) {
        // Parent owns post-save UX (toast copy, navigation, etc.).
        onSaveSuccess(saved)
      } else {
        // Standalone fallback: built-in generic toast.
        showToast(t('quickAdd.savedToast'), { variant: 'success' })
      }
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      clearTimeout(timeoutHandle)
      setSaving(false)
    }
  }, [saving, isOutsideServicePeriods, closedHoursAck, form, showToast, t, onClose])

  if (!isOpen) return null

  const showClosedHoursWarning = isOutsideServicePeriods && !closedHoursAck
  const availabilityLine = (() => {
    if (!availability) return null
    if (availability.anyMatchCount === 0) {
      return { text: t('quickAdd.availabilityCombining'), tone: 'warning' }
    }
    if (availability.anyMatchCount === 1) {
      return { text: t('quickAdd.availabilityLastOne'), tone: 'caution' }
    }
    return {
      text: t('quickAdd.availabilityExact', {
        count: availability.exactMatchCount || availability.anyMatchCount,
        time: form.time,
        party: form.partySize,
      }),
      tone: 'ok',
    }
  })()

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-[560px] sm:rounded-xl rounded-t-2xl shadow-xl max-h-[95vh] overflow-y-auto"
      >
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900">{t('quickAdd.title')}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-gray-400 hover:text-gray-700 text-2xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
            >×</button>
          </div>

          {/* C6 P3-8 §3.10: when launched from a calendar cell, show the
              pre-selected table as a passive badge. The waiter can clear
              it (× button) to fall back to the unassigned-AutoConfirmed
              path per §9.5. No full table-picker per §3.3. */}
          {prefilledTableId && prefilledTableLabel && (
            <div className="flex items-center gap-2 bg-primary-bg text-primary border border-primary/30 rounded px-3 py-2 text-sm">
              <span className="font-medium">
                {t('quickAdd.prefilledTable', { tableLabel: prefilledTableLabel })}
              </span>
              <button
                type="button"
                onClick={() => { setPrefilledTableId(null); setPrefilledTableLabel(null) }}
                aria-label={t('quickAdd.clearPrefilledTable')}
                className="ml-auto text-primary hover:opacity-75 text-base leading-none min-w-[24px] min-h-[24px] flex items-center justify-center"
              >×</button>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">{t('quickAdd.guestName')}</label>
            <input
              ref={nameInputRef}
              type="text"
              value={form.guestName}
              onChange={handleField('guestName')}
              autoComplete="name"
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t('quickAdd.date')}</label>
              <input
                type="date"
                value={form.date}
                onChange={handleField('date')}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('quickAdd.time')}</label>
              <input
                type="time"
                value={form.time}
                onChange={handleField('time')}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('quickAdd.partySize')}</label>
              <input
                type="number"
                min="1"
                max="30"
                value={form.partySize}
                onChange={handleField('partySize')}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
              />
            </div>
          </div>

          {/* Optional details */}
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="text-sm text-primary hover:underline"
          >
            {t('quickAdd.addDetails')}
          </button>
          {detailsOpen && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('quickAdd.guestPhone')} <span className="text-gray-400 text-xs">{t('quickAdd.optional')}</span>
                </label>
                <input
                  type="tel"
                  value={form.guestPhone}
                  onChange={handleField('guestPhone')}
                  autoComplete="tel"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('quickAdd.specialRequests')} <span className="text-gray-400 text-xs">{t('quickAdd.optional')}</span>
                </label>
                <textarea
                  rows={2}
                  value={form.specialRequests}
                  onChange={handleField('specialRequests')}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base"
                />
              </div>
            </div>
          )}

          {/* Live availability hint */}
          {availabilityLine && (
            <div
              className={`text-sm rounded-md px-3 py-2 ${
                availabilityLine.tone === 'ok'
                  ? 'bg-green-50 text-green-900 border border-green-200'
                  : availabilityLine.tone === 'caution'
                    ? 'bg-amber-50 text-amber-900 border border-amber-200'
                    : 'bg-amber-50 text-amber-900 border border-amber-200'
              }`}
            >
              {availabilityLine.text}
            </div>
          )}

          {/* Closed-hours warning */}
          {showClosedHoursWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-3">
              <p>{t('quickAdd.closedHoursWarning', { time: form.time })}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setClosedHoursAck(true)}
                  className="px-3 py-2 rounded bg-amber-600 text-white text-sm font-semibold min-h-[40px]"
                >
                  {t('common.yes')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 rounded bg-white text-gray-800 border border-gray-300 text-sm font-semibold min-h-[40px]"
                >
                  {t('common.no')}
                </button>
              </div>
            </div>
          )}

          {/* Error / timeout */}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          )}
          {timedOut && (
            <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
              {t('quickAdd.timeoutError')}
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-3 rounded bg-primary text-white font-semibold min-h-[48px] disabled:opacity-60"
            >
              {saving ? t('quickAdd.saving') : t('quickAdd.save')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 rounded border border-gray-300 text-gray-800 font-semibold min-h-[48px]"
            >
              {t('actions.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
