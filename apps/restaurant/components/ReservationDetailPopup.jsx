'use client'

// Shared Reservation Detail popup (C6 Phase 2).
// Per memory/waiter_ux_strategy.md §3.1 — including the state-action matrix
// in §3.1's table. This is the foundation that 3.2–3.13 build on; Phase 3
// will mount it into Reservations / Calendar / Live / Dashboard.
//
// Props:
//   reservation: the reservation row (id, guestName, partySize, time, date,
//     status, table?, user?, specialRequests, secondsLate?). Tolerates
//     either shape — restaurant API rows (with table+user includes) and the
//     summary shapes from dashboard/summary and layout/live.
//   isOpen: boolean
//   onClose: () => void
//   onAction: (actionType, reservation) => void
//     actionType ∈ 'confirm' | 'reject' | 'edit' | 'cancel' | 'pickTable'
//                | 'reassignTable' | 'seat' | 'noshow' | 'complete'
//
// Behavior:
//   - Renders the contextual action button row from §3.1 matrix.
//   - Subscribes to reservation:updated for the open reservation id and
//     re-renders with the new data without close/reopen.
//   - Subscribes to reservation:cancelled and closes via toast if the
//     displayed reservation gets cancelled externally.
//   - "X min late" badge when secondsLate > 600 (10 min — §3.13).
//   - Special-request badge ✦ next to guest name when non-empty.
//   - Responsive: full-screen bottom sheet at <768px, centered modal
//     max-width 560px at ≥768px (per §4.5).

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { subscribe } from '../lib/socket'
import { apiGet, apiPut } from '../lib/api'
import { useToast } from './ui/ToastProvider'
import ActionButton from './ui/ActionButton'

function isWithinAnyServicePeriod(profile, time) {
  const periods = profile?.servicePeriods || []
  if (periods.length === 0) return true
  for (const p of periods) {
    if (time >= p.startTime && time < p.endTime) return true
  }
  return false
}

// Convert a Reservation.date (ISO string or Date) into the YYYY-MM-DD
// shape required by <input type="date">.
function isoDateOnly(d) {
  if (!d) return ''
  const s = typeof d === 'string' ? d : d.toISOString()
  return s.slice(0, 10)
}

// State→actions matrix per §3.1.
function actionsForStatus(reservation) {
  const status = reservation?.status
  const hasTable = !!(reservation?.tableId || reservation?.table?.id)
  switch (status) {
    case 'PENDING':
      return ['confirm', 'reject', 'edit', 'cancel']
    case 'CONFIRMED':
      return hasTable
        ? ['edit', 'reassignTable', 'cancel']
        : ['edit', 'pickTable', 'cancel']
    case 'AUTO_CONFIRMED':
      return hasTable
        ? ['edit', 'reassignTable', 'cancel']
        : ['edit', 'pickTable', 'cancel']
    case 'AWAITING_GUEST':
      return ['seat', 'noshow', 'edit', 'cancel']
    case 'OCCUPIED':
      return ['complete', 'cancel']
    case 'COMPLETED':
    case 'CANCELLED':
    case 'NO_SHOW':
      return [] // view-only
    case 'MODIFICATION_PENDING':
      return [] // Tier D
    default:
      return []
  }
}

function guestNameOf(r) {
  if (!r) return ''
  if (r.guestName) return r.guestName
  const u = r.user
  if (u) return [u.firstName, u.lastName].filter(Boolean).join(' ')
  return ''
}

function tableLabelOf(r) {
  if (!r) return null
  if (r.tableLabel) return r.tableLabel
  // tableNumber already carries the "T" prefix (e.g. "T5") per the
  // canonical fix in commit 5eabdc0; don't double-prepend.
  if (r.table?.tableNumber != null) return r.table.tableNumber
  return null
}

export default function ReservationDetailPopup({ reservation, isOpen, onClose, onAction }) {
  const t = useTranslations()
  const { show: showToast } = useToast()
  // Mirror the incoming reservation in local state so socket updates can
  // re-render without the parent re-passing the prop.
  const [current, setCurrent] = useState(reservation)
  useEffect(() => { setCurrent(reservation) }, [reservation])
  // Per-action processing flag drives the spinner on the ActionButton
  // for actions the popup handles internally (currently: noshow, edit).
  // Other actions still forward via onAction and the parent owns their UX.
  const [processingAction, setProcessingAction] = useState(null)
  const [actionError, setActionError] = useState('')

  // C6 P3-6 edit-mode state. View ↔ edit toggle inside the same popup —
  // no new modal stack. editForm holds the in-flight values; profile is
  // fetched on first edit-mode entry for the closed-hours warning and
  // mirrors the QuickAdd pattern.
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    date: '', time: '', partySize: '', guestPhone: '', specialRequests: '',
  })
  const [profile, setProfile] = useState(null)
  const [availability, setAvailability] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [editTimedOut, setEditTimedOut] = useState(false)
  const [closedHoursAck, setClosedHoursAck] = useState(false)
  const [closedHoursDismissed, setClosedHoursDismissed] = useState(false)

  // Subscribe to live updates for the open reservation.
  useEffect(() => {
    if (!isOpen || !current?.id) return
    const id = current.id
    const onUpdated = (payload) => {
      if (payload?.id !== id) return
      setCurrent((prev) => ({ ...(prev || {}), ...payload }))
    }
    const onCancelled = (payload) => {
      if (payload?.id !== id) return
      showToast(t('statusLabel.CANCELLED'), { variant: 'warning' })
      onClose()
    }
    const unsubs = [
      subscribe('reservation:updated', onUpdated),
      subscribe('reservation:cancelled', onCancelled),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [isOpen, current?.id, t, showToast, onClose])

  if (!isOpen || !current) return null

  const actions = actionsForStatus(current)
  const guest = guestNameOf(current)
  const tableLabel = tableLabelOf(current)
  const hasSpecial = !!(current.specialRequests && String(current.specialRequests).trim())
  const minutesLate = current.secondsLate && current.secondsLate > 600
    ? Math.floor(current.secondsLate / 60)
    : null
  const statusKey = current.status ? `statusLabel.${current.status}` : null

  // C6 P3-5: no-show is handled inside the popup (closes + toast with
  // 10s undo grace), so the parent doesn't need to know about it. Undo
  // is wired against /restore-no-show with a race-safe 409 surface per
  // §3.5. Other actions forward via onAction unchanged.
  const handleNoShow = async () => {
    if (processingAction || !current?.id) return
    setProcessingAction('noshow')
    setActionError('')
    try {
      const result = await apiPut(`/api/restaurant/reservations/${current.id}/no-show`)
      // Snapshot the table label for the undo-failure copy — `current`
      // may be empty post-close.
      const tableLabel = result?.tableLabel || tableLabelOf(current) || ''
      const guestForToast = guestNameOf(current) || '—'
      onClose()
      showToast(t('noShow.toast.marked', { name: guestForToast }), {
        variant: 'undo',
        durationMs: 10000,
        actionLabel: t('noShow.toast.undo'),
        onAction: () => handleUndoNoShow(current.id, guestForToast, tableLabel),
      })
    } catch (err) {
      setActionError(err?.message || 'Failed to mark no-show')
    } finally {
      setProcessingAction(null)
    }
  }

  const handleUndoNoShow = async (reservationId, guestForToast, tableLabel) => {
    try {
      await apiPut(`/api/restaurant/reservations/${reservationId}/restore-no-show`)
      showToast(t('noShow.toast.undone', { name: guestForToast }), {
        variant: 'success',
        durationMs: 4000,
      })
    } catch (err) {
      // Backend returns 409 with { error: 'table-no-longer-free',
      // tableLabel } when the race-with-walk-in hits. The frontend
      // apiPut helper flattens that into a string message.
      const isRace = /table-no-longer-free|409/i.test(err?.message || '')
      if (isRace) {
        showToast(t('noShow.toast.undoFailed', { tableLabel }), {
          variant: 'error',
          durationMs: 6000,
        })
      } else {
        showToast(err?.message || 'Undo failed', { variant: 'error' })
      }
    }
  }

  // C6 P3-6: edit mode is popup-internal. Click 'edit' → populate
  // editForm from `current`, fetch profile (once per popup lifetime)
  // for the closed-hours warning, swap to the edit-form layout.
  const enterEditMode = () => {
    setEditForm({
      date: isoDateOnly(current.date),
      time: current.time || '',
      partySize: String(current.partySize ?? ''),
      guestPhone: current.guestPhone || current.user?.phone || '',
      specialRequests: current.specialRequests || '',
    })
    setEditError('')
    setEditTimedOut(false)
    setClosedHoursAck(false)
    setClosedHoursDismissed(false)
    setEditMode(true)
    if (!profile) {
      apiGet('/api/restaurant/profile').then(setProfile).catch(() => { /* warning silently disabled */ })
    }
  }

  const exitEditMode = () => {
    setEditMode(false)
    setEditError('')
    setEditTimedOut(false)
  }

  const handleEditField = (field) => (e) => {
    const value = e.target.value
    setEditForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'time') {
      // User changed the time — re-evaluate the closed-hours gate.
      setClosedHoursAck(false)
      setClosedHoursDismissed(false)
    }
  }

  const handleEditSave = async () => {
    if (editSaving || !current?.id) return
    if (isOutsideHours && !closedHoursAck) return

    setEditSaving(true)
    setEditError('')
    setEditTimedOut(false)
    const timeoutHandle = setTimeout(() => setEditTimedOut(true), 10000)

    try {
      // Send only fields that changed against `current`. Sending unchanged
      // fields would also work (backend's updateMany is idempotent), but
      // the diff payload is cheaper + easier to inspect in network logs.
      const body = {}
      if (editForm.date && editForm.date !== isoDateOnly(current.date)) body.date = editForm.date
      if (editForm.time && editForm.time !== current.time) body.time = editForm.time
      if (editForm.partySize !== '' && parseInt(editForm.partySize) !== current.partySize) {
        body.partySize = parseInt(editForm.partySize)
      }
      if (editForm.guestPhone !== (current.guestPhone || '')) body.guestPhone = editForm.guestPhone
      if (editForm.specialRequests !== (current.specialRequests || '')) {
        body.specialRequests = editForm.specialRequests
      }
      if (Object.keys(body).length === 0) {
        // Nothing changed — just exit edit mode.
        exitEditMode()
        return
      }

      const saved = await apiPut(`/api/restaurant/reservations/${current.id}`, body)
      setCurrent(saved)
      setEditMode(false)
      showToast(
        t('edit.toast.saved', { name: guestNameOf(saved) || '—' }),
        { variant: 'success', durationMs: 4000 }
      )
    } catch (err) {
      const msg = err?.message || ''
      // 409 from the backend's table-conflict check (added in P3-6) is
      // surfaced as a specific, actionable error.
      if (/table-conflict/i.test(msg)) {
        setEditError(t('edit.error.tableConflict', {
          tableLabel: tableLabelOf(current) || '—',
          time: editForm.time || current.time || '',
        }))
      } else {
        setEditError(msg || 'Save failed')
      }
    } finally {
      clearTimeout(timeoutHandle)
      setEditSaving(false)
    }
  }

  // Debounced availability lookup, mirroring QuickAdd's §3.3 pattern.
  // Only runs in edit mode AND when the three driving fields are set.
  useEffect(() => {
    if (!editMode) { setAvailability(null); return }
    if (!editForm.date || !editForm.time || !editForm.partySize) {
      setAvailability(null)
      return
    }
    const handle = setTimeout(async () => {
      try {
        const data = await apiGet(
          `/api/restaurant/availability?date=${encodeURIComponent(editForm.date)}` +
          `&time=${encodeURIComponent(editForm.time)}` +
          `&partySize=${encodeURIComponent(editForm.partySize)}`
        )
        setAvailability(data)
      } catch {
        setAvailability(null)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [editMode, editForm.date, editForm.time, editForm.partySize])

  const isOutsideHours = useMemo(() => {
    if (!profile || !editForm.time) return false
    return !isWithinAnyServicePeriod(profile, editForm.time)
  }, [profile, editForm.time])

  const handleAction = (actionType) => {
    if (actionType === 'noshow') return handleNoShow()
    if (actionType === 'edit') return enterEditMode()
    if (onAction) onAction(actionType, current)
  }

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
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <span>{guest || '—'}</span>
                {hasSpecial && (
                  <span
                    title={t('popup.specialRequestsBadge')}
                    aria-label={t('popup.specialRequestsBadge')}
                    className="text-amber-500 text-xl"
                  >✦</span>
                )}
              </h2>
              <div className="text-sm text-gray-500 mt-1">{t('popup.title')}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="text-gray-400 hover:text-gray-700 text-2xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
            >×</button>
          </div>

          {editMode ? (
            // ============================================================
            // EDIT MODE — C6 P3-6. Form layout mirrors QuickAddReservation
            // so the visual language is consistent. Save uses pending-sync
            // per §4.2; closed-hours warning gates save the same way Quick
            // Add does. Specific 409 table-conflict error rendered inline.
            // ============================================================
            <div className="space-y-4">
              <p className="text-sm text-gray-500 -mt-3">{t('edit.title')}</p>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('edit.field.date')}</label>
                  <input
                    type="date"
                    value={editForm.date}
                    onChange={handleEditField('date')}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('edit.field.time')}</label>
                  <input
                    type="time"
                    value={editForm.time}
                    onChange={handleEditField('time')}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('edit.field.party')}</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={editForm.partySize}
                    onChange={handleEditField('partySize')}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('edit.field.phone')}</label>
                <input
                  type="tel"
                  value={editForm.guestPhone}
                  onChange={handleEditField('guestPhone')}
                  autoComplete="tel"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t('edit.field.specialRequests')}</label>
                <textarea
                  rows={2}
                  value={editForm.specialRequests}
                  onChange={handleEditField('specialRequests')}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base"
                />
              </div>

              {/* Availability hint — same copy + tone scale as QuickAdd. */}
              {availability && (
                <div
                  className={`text-sm rounded-md px-3 py-2 border ${
                    availability.anyMatchCount === 0
                      ? 'bg-amber-50 text-amber-900 border-amber-200'
                      : availability.anyMatchCount === 1
                        ? 'bg-amber-50 text-amber-900 border-amber-200'
                        : 'bg-green-50 text-green-900 border-green-200'
                  }`}
                >
                  {availability.anyMatchCount === 0
                    ? t('quickAdd.availabilityCombining')
                    : availability.anyMatchCount === 1
                      ? t('quickAdd.availabilityLastOne')
                      : t('quickAdd.availabilityExact', {
                          count: availability.exactMatchCount || availability.anyMatchCount,
                          time: editForm.time,
                          party: editForm.partySize,
                        })}
                </div>
              )}

              {/* Closed-hours warning + ack. Reuses QuickAdd's pattern. */}
              {isOutsideHours && !closedHoursDismissed && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-3">
                  <p>{t('edit.warning.closedHours', { time: editForm.time })}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setClosedHoursAck(true); setClosedHoursDismissed(true) }}
                      className="px-3 py-2 rounded bg-amber-600 text-white text-sm font-semibold min-h-[40px]"
                    >
                      {t('common.yes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setClosedHoursDismissed(true)}
                      className="px-3 py-2 rounded bg-white text-gray-800 border border-gray-300 text-sm font-semibold min-h-[40px]"
                    >
                      {t('common.no')}
                    </button>
                  </div>
                </div>
              )}

              {/* Error / timeout */}
              {editError && (
                <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{editError}</div>
              )}
              {editTimedOut && (
                <div className="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
                  {t('edit.error.timeoutRetry')}
                </div>
              )}

              {/* Save / Cancel */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleEditSave}
                  disabled={editSaving || (isOutsideHours && !closedHoursAck)}
                  className="flex-1 px-4 py-3 rounded bg-primary text-white font-semibold min-h-[48px] disabled:opacity-60"
                >
                  {editSaving ? t('edit.button.saving') : t('edit.button.save')}
                </button>
                <button
                  type="button"
                  onClick={exitEditMode}
                  className="px-4 py-3 rounded border border-gray-300 text-gray-800 font-semibold min-h-[48px]"
                >
                  {t('edit.button.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Status + late badge */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {statusKey && (
                  <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                    {t(statusKey)}
                  </span>
                )}
                {minutesLate != null && (
                  <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-900">
                    {t('popup.minutesLate', { minutes: minutesLate })}
                  </span>
                )}
              </div>

              {/* Detail grid */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-6">
                <div>
                  <dt className="text-gray-500 font-medium">{t('popup.time')}</dt>
                  <dd className="text-gray-900 mt-0.5">{current.time || '—'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 font-medium">{t('popup.partySize')}</dt>
                  <dd className="text-gray-900 mt-0.5">{current.partySize ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 font-medium">{t('popup.table')}</dt>
                  <dd className="text-gray-900 mt-0.5">{tableLabel || t('popup.noTableAssigned')}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 font-medium">{t('popup.phone')}</dt>
                  <dd className="text-gray-900 mt-0.5">{current.guestPhone || current.user?.phone || t('popup.noPhone')}</dd>
                </div>
                {hasSpecial && (
                  <div className="col-span-2">
                    <dt className="text-gray-500 font-medium">{t('popup.specialRequests')}</dt>
                    <dd className="text-gray-900 mt-0.5 whitespace-pre-wrap">{current.specialRequests}</dd>
                  </div>
                )}
              </dl>

              {/* Inline error for popup-handled actions (noshow today). */}
              {actionError && (
                <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  {actionError}
                </div>
              )}

              {/* Actions */}
              {actions.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  {current.status === 'MODIFICATION_PENDING'
                    ? t('popup.modificationDeferred')
                    : t('popup.noActionsAvailable')}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {actions.map((variant) => (
                    <ActionButton
                      key={variant}
                      variant={variant}
                      onClick={() => handleAction(variant)}
                      loading={processingAction === variant}
                      disabled={!!processingAction && processingAction !== variant}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
