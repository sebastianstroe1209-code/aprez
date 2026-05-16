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

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { subscribe } from '../lib/socket'
import { apiPut } from '../lib/api'
import { useToast } from './ui/ToastProvider'
import ActionButton from './ui/ActionButton'

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
  // for actions the popup handles internally (currently: noshow). Other
  // actions still forward via onAction and the parent owns their UX.
  const [processingAction, setProcessingAction] = useState(null)
  const [actionError, setActionError] = useState('')

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

  const handleAction = (actionType) => {
    if (actionType === 'noshow') return handleNoShow()
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
        </div>
      </div>
    </div>
  )
}
