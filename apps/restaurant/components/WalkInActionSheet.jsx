'use client'

// Walk-in fast-seating action sheet (C6 P3-4).
// Per memory/waiter_ux_strategy.md §3.4: party stepper, optional name,
// override warnings (capacity, ARRIVING_SOON within 30 min), pending-sync
// save per §4.2. Responsive: full-screen bottom sheet at <768px,
// centered 560px modal at ≥768px.
//
// Props:
//   table:    the table being seated. { id, tableNumber, seatCount, status }
//   isOpen:   boolean
//   onClose:  () => void
//   onSeated: (updated) => void
//     fired after the server returns 200. Parent can refetch or surface
//     a follow-up toast (the Live page does both).
//   arrivingSoonWarning?: { name, party, minutes }
//     when provided, surfaces a Yes/Cancel ack BEFORE the form per §3.4.
//     Yes collapses the ack and reveals the normal form; Cancel closes
//     the sheet outright. Pass null for non-Arriving-Soon tables.

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiPut } from '../lib/api'
import { useToast } from './ui/ToastProvider'

export default function WalkInActionSheet({
  table,
  isOpen,
  onClose,
  onSeated,
  arrivingSoonWarning = null,
}) {
  const t = useTranslations()
  const { show: showToast } = useToast()
  const [partySize, setPartySize] = useState(2)
  const [nameOpen, setNameOpen] = useState(false)
  const [walkInName, setWalkInName] = useState('')
  // Acks for the two override paths. arrivingSoonWarning gates the entire
  // form behind a Yes-button; capacity warning gates only the Save action.
  const [arrivingAcked, setArrivingAcked] = useState(false)
  const [capacityAcked, setCapacityAcked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)

  // Reset transient state every time the sheet (re)opens for a new table.
  useEffect(() => {
    if (!isOpen) return
    setPartySize(2)
    setNameOpen(false)
    setWalkInName('')
    setArrivingAcked(false)
    setCapacityAcked(false)
    setError('')
    setTimedOut(false)
    setSaving(false)
  }, [isOpen, table?.id])

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const seatCount = table?.seatCount ?? 0
  const overCapacity = seatCount > 0 && partySize > seatCount
  const needsArrivingAck = !!arrivingSoonWarning && !arrivingAcked

  const handleSave = useCallback(async () => {
    if (saving || !table) return
    if (needsArrivingAck) return
    if (overCapacity && !capacityAcked) return

    setSaving(true)
    setError('')
    setTimedOut(false)
    const timeoutHandle = setTimeout(() => setTimedOut(true), 10000)

    try {
      const body = { guestCount: partySize }
      if (walkInName.trim()) body.walkInName = walkInName.trim()
      const updated = await apiPut(`/api/restaurant/tables/${table.id}/seat`, body)
      showToast(
        t('walkIn.toast.seated', {
          // tableNumber already carries the "T" prefix per the canonical
          // fix in commit 5eabdc0; don't double-prepend.
          tableLabel: table.tableNumber,
          party: partySize,
        }),
        { variant: 'success', durationMs: 4000 }
      )
      if (onSeated) onSeated(updated)
      onClose()
    } catch (err) {
      // 409 typically means status changed under us (Occupied/OOS).
      const msg = err?.message || ''
      if (/occupied|out of service|409/i.test(msg)) {
        setError(t('walkIn.error.tableNotFree'))
      } else {
        setError(msg || t('walkIn.error.tableNotFree'))
      }
    } finally {
      clearTimeout(timeoutHandle)
      setSaving(false)
    }
  }, [saving, table, needsArrivingAck, overCapacity, capacityAcked, partySize, walkInName, showToast, t, onSeated, onClose])

  if (!isOpen || !table) return null

  // tableNumber already carries the "T" prefix (e.g. "T5"). Pre-fix this
  // was `T${table.tableNumber}` which rendered as "TT5".
  const tableLabel = table.tableNumber

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center p-0 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-[560px] sm:rounded-xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{t('walkIn.title')}</h2>
              <p className="text-sm text-gray-500 mt-1">
                {t('walkIn.subtitle', { tableLabel, seats: seatCount })}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-gray-400 hover:text-gray-700 text-2xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
            >×</button>
          </div>

          {/* ARRIVING_SOON ack gate — blocks the form until user confirms. */}
          {needsArrivingAck ? (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {t('walkIn.warning.arrivingSoon', {
                  tableLabel,
                  minutes: arrivingSoonWarning.minutes,
                  name: arrivingSoonWarning.name || '—',
                  party: arrivingSoonWarning.party || '—',
                })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setArrivingAcked(true)}
                  className="flex-1 px-4 py-3 rounded bg-amber-600 text-white font-semibold min-h-[48px]"
                >
                  {t('common.yes')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-3 rounded border border-gray-300 text-gray-800 font-semibold min-h-[48px]"
                >
                  {t('walkIn.buttonCancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Party-size stepper */}
              <div>
                <label className="block text-sm font-medium mb-2">{t('walkIn.partyStepperLabel')}</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => { setPartySize((n) => Math.max(1, n - 1)); setCapacityAcked(false) }}
                    aria-label="−"
                    className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 text-xl font-bold text-gray-800 flex items-center justify-center"
                  >−</button>
                  <span className="text-3xl font-bold tabular-nums w-12 text-center">{partySize}</span>
                  <button
                    type="button"
                    onClick={() => { setPartySize((n) => n + 1); setCapacityAcked(false) }}
                    aria-label="+"
                    className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 text-xl font-bold text-gray-800 flex items-center justify-center"
                  >+</button>
                </div>
              </div>

              {/* Over-capacity warning + ack */}
              {overCapacity && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
                  <p>{t('walkIn.warning.overCapacity', { party: partySize, seats: seatCount })}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCapacityAcked(true)}
                      className={`px-3 py-1.5 rounded text-sm font-semibold min-h-[36px] ${
                        capacityAcked
                          ? 'bg-amber-700 text-white'
                          : 'bg-amber-600 hover:bg-amber-700 text-white'
                      }`}
                    >
                      {t('common.yes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPartySize(seatCount)}
                      className="px-3 py-1.5 rounded bg-white text-gray-800 border border-gray-300 text-sm font-semibold min-h-[36px]"
                    >
                      {t('common.no')}
                    </button>
                  </div>
                </div>
              )}

              {/* Optional name */}
              {!nameOpen ? (
                <button
                  type="button"
                  onClick={() => setNameOpen(true)}
                  className="text-sm text-primary hover:underline"
                >
                  {t('walkIn.nameFieldToggle')}
                </button>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">{t('walkIn.nameFieldLabel')}</label>
                  <input
                    type="text"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    autoComplete="off"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                  />
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
                  type="button"
                  onClick={handleSave}
                  disabled={saving || (overCapacity && !capacityAcked)}
                  className="flex-1 px-4 py-3 rounded bg-primary text-white font-semibold min-h-[48px] disabled:opacity-60"
                >
                  {saving ? t('walkIn.saving') : t('walkIn.buttonSeat')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-3 rounded border border-gray-300 text-gray-800 font-semibold min-h-[48px]"
                >
                  {t('walkIn.buttonCancel')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
