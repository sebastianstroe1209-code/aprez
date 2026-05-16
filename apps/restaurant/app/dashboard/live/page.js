'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiGet, apiPut } from '../../../lib/api'
import { formatTime } from '../../../lib/format'
import { subscribe } from '../../../lib/socket'
import { useSocketRefetch } from '../../../lib/useSocketRefetch'
import ReservationDetailPopup from '../../../components/ReservationDetailPopup'
import WalkInActionSheet from '../../../components/WalkInActionSheet'
import SpecialRequestsBadge from '../../../components/ui/SpecialRequestsBadge'
import MinLateBadge from '../../../components/ui/MinLateBadge'

// Statuses that, per memory/waiter_ux_strategy.md §3.7, carry an inline
// guest+party+time overlay on the floor-plan card. Free + OOS render
// status only (existing behavior preserved).
const OVERLAY_STATUSES = new Set(['OCCUPIED', 'ARRIVING_SOON', 'AWAITING_GUEST'])

function truncateGuestName(name) {
  if (!name) return ''
  return name.length > 12 ? name.slice(0, 12) + '…' : name
}

const statusColors = {
  FREE: { bg: 'bg-green-50', border: 'border-table-free', text: 'text-green-900', label: 'Free' },
  OCCUPIED: { bg: 'bg-red-50', border: 'border-table-occupied', text: 'text-red-900', label: 'Occupied' },
  ARRIVING_SOON: { bg: 'bg-orange-50', border: 'border-table-arriving', text: 'text-orange-900', label: 'Arriving Soon' },
  AWAITING_GUEST: { bg: 'bg-pink-50', border: 'border-table-awaiting', text: 'text-pink-900', label: 'Awaiting Guest' },
  OUT_OF_SERVICE: { bg: 'bg-gray-50', border: 'border-table-out', text: 'text-gray-900', label: 'Out of Service' },
}

export default function LiveFloorPlanPage() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const confirmReservationId = searchParams.get('confirmReservationId')

  const [sections, setSections] = useState([])
  // liveByTableId: { [tableId]: { currentReservation, nextReservation,
  // secondsLate, occupancyDurationMin } } — augmented per-table data
  // from the C6 Phase 1 amended /layout/live endpoint. Merged into the
  // section/grid structure (which still comes from /layout) at render
  // time so we don't lose the grid coordinates.
  const [liveByTableId, setLiveByTableId] = useState({})
  const [activeSection, setActiveSection] = useState(null)
  const [selectedTable, setSelectedTable] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [guestCount, setGuestCount] = useState(1)
  const [modalAction, setModalAction] = useState('status') // 'status' or 'seat'
  const [lastRefresh, setLastRefresh] = useState(null)
  // Reservation popup (P3-3 §3.7): opens when staff taps a table that has
  // an associated reservation. Replaces the click-to-status-modal flow for
  // OCCUPIED / ARRIVING_SOON / AWAITING_GUEST tables; Free + OOS tables
  // are click-inert in this phase (Free becomes the walk-in target in P3-4).
  const [popupReservation, setPopupReservation] = useState(null)
  const [popupOpen, setPopupOpen] = useState(false)
  // Walk-in action sheet (P3-4). Opens on FREE-table click and on
  // ARRIVING_SOON-table click (with a pre-form warning if the upcoming
  // reservation is within 30 minutes per §3.4 edge cases).
  const [walkInTable, setWalkInTable] = useState(null)
  const [walkInArrivingWarning, setWalkInArrivingWarning] = useState(null)

  // Confirm-mode: when ?confirmReservationId=<id> is set, the page enters a
  // restricted picker mode. Eligible tables are highlighted; clicking one
  // assigns it to the reservation instead of opening the status modal.
  const [confirmReservation, setConfirmReservation] = useState(null)
  const [eligibleTableIds, setEligibleTableIds] = useState(null) // null = not loaded; Set on success

  useEffect(() => {
    loadLayout()
    const interval = setInterval(loadLayout, 30000) // Auto-refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  // C4 real-time table-status updates (§5a). Patch table in place rather than
  // refetching the whole layout — keeps the live view responsive even at
  // busy times. The overlay fields (currentReservation, nextReservation,
  // secondsLate) aren't in the table:status-changed payload (see
  // server/src/socket/events.md), so on reservation:* events we trigger a
  // quiet refetch to keep the overlay in sync.
  useEffect(() => {
    const applyTableStatus = ({ tableId, newStatus, statusChangedAt }) => {
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          tables: sec.tables.map((t) =>
            t.id === tableId ? { ...t, status: newStatus, statusChangedAt } : t
          ),
        }))
      )
      setLastRefresh(new Date())
    }
    const refetchOverlay = () => { loadLayout(true) }
    const unsubs = [
      subscribe('table:status-changed', applyTableStatus),
      subscribe('reservation:created', refetchOverlay),
      subscribe('reservation:updated', refetchOverlay),
      subscribe('reservation:cancelled', refetchOverlay),
      subscribe('walkin:created', refetchOverlay),
      subscribe('walkin:ended', refetchOverlay),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [])

  const refetchOnReconnect = useCallback(() => { loadLayout(true) }, [])
  useSocketRefetch(refetchOnReconnect)

  useEffect(() => {
    if (!confirmReservationId) {
      setConfirmReservation(null)
      setEligibleTableIds(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiGet(`/api/restaurant/reservations/${confirmReservationId}/eligible-tables`)
        if (cancelled) return
        setConfirmReservation(data.reservation)
        setEligibleTableIds(new Set(data.eligibleTableIds))
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load eligible tables')
      }
    })()
    return () => { cancelled = true }
  }, [confirmReservationId])

  const exitConfirmMode = () => {
    router.push('/dashboard/live')
  }

  const handleAssignFromConfirm = async (table) => {
    if (!confirmReservation) return
    try {
      const status = confirmReservation.status
      const path = status === 'PENDING'
        ? `/api/restaurant/reservations/${confirmReservation.id}/confirm`
        : `/api/restaurant/reservations/${confirmReservation.id}/assign-table`
      await apiPut(path, { tableId: table.id })
      router.push('/dashboard/live')
      loadLayout()
    } catch (err) {
      alert('Failed to assign table: ' + err.message)
    }
  }

  // Two queries in parallel: /layout gives the section/grid structure
  // (gridRows, gridColumns, table positions) — the augmented /layout/live
  // endpoint returns a flat table list with currentReservation /
  // nextReservation / secondsLate but no section nesting. Merging client-
  // side by tableId keeps both shapes intact. `quiet=true` skips the
  // loading flag for background refetches (socket / 30s tick / focus).
  const loadLayout = async (quiet = false) => {
    try {
      const [sectionsData, liveTables] = await Promise.all([
        apiGet('/api/restaurant/layout'),
        apiGet('/api/restaurant/layout/live'),
      ])
      const byId = {}
      for (const tbl of liveTables || []) {
        byId[tbl.id] = {
          currentReservation: tbl.currentReservation || null,
          nextReservation: tbl.nextReservation || null,
          secondsLate: tbl.secondsLate ?? null,
          occupancyDurationMin: tbl.occupancyDurationMin ?? null,
        }
      }
      setSections(sectionsData)
      setLiveByTableId(byId)
      setLastRefresh(new Date())
      setActiveSection((prev) => {
        if (prev && sectionsData.find((s) => s.id === prev)) return prev
        return sectionsData.length > 0 ? sectionsData[0].id : null
      })
    } catch (err) {
      setError(err.message || 'Failed to load floor plan')
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  // §3.7 + §3.4 click behavior:
  //  - OCCUPIED / AWAITING_GUEST: open ReservationDetailPopup (P3-3).
  //  - ARRIVING_SOON: two paths — if the upcoming reservation is within
  //    30 min, open the walk-in sheet WITH a pre-form warning (§3.4 edge
  //    case); otherwise open ReservationDetailPopup on the upcoming
  //    reservation (matches the previous P3-3 behavior). The user spec
  //    for P3-4 routes ARRIVING_SOON clicks to the walk-in sheet, but
  //    it's a destructive flow if the upcoming reservation is imminent —
  //    so the warning gate guards it.
  //  - FREE: open walk-in action sheet (P3-4 replaces the no-op).
  //  - OUT_OF_SERVICE: no-op (out of C6 scope).
  //  - Confirm-mode (?confirmReservationId=…): routes via inline click.
  const handleTableClick = (table) => {
    if (table.status === 'OUT_OF_SERVICE') return

    if (table.status === 'FREE') {
      setWalkInArrivingWarning(null)
      setWalkInTable(table)
      return
    }

    if (table.status === 'ARRIVING_SOON') {
      const overlay = liveByTableId[table.id]
      const next = overlay?.nextReservation
      if (next?.time) {
        const [h, m] = next.time.split(':').map(Number)
        const now = new Date()
        const buchHm = now.toLocaleTimeString('en-GB', {
          timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
        })
        const [nh, nm] = buchHm.split(':').map(Number)
        const minutesUntil = (h * 60 + m) - (nh * 60 + nm)
        if (minutesUntil >= 0 && minutesUntil < 30) {
          setWalkInArrivingWarning({
            name: next.guestName || '—',
            party: next.partySize ?? '—',
            minutes: minutesUntil,
          })
          setWalkInTable(table)
          return
        }
      }
      // ≥30 min until next reservation → no immediate seating risk, open
      // the popup so staff can review the upcoming guest. Walk-in is
      // still reachable via Free tables.
      if (next) {
        setPopupReservation({
          ...next,
          // table.status threads into the popup so its actionsForStatus
      // helper can derive the AwaitingGuest action set (Seat + No-show)
      // even though the reservation's own status is CONFIRMED /
      // AUTO_CONFIRMED — see ReservationDetailPopup's isAwaitingGuestDerived.
      table: { id: table.id, tableNumber: table.tableNumber, seatCount: table.seatCount, status: table.status },
      // secondsLate is the Dashboard-summary equivalent of the same
      // signal; pass it through too so the derivation works regardless
      // of which path supplied the data.
      secondsLate: overlay?.secondsLate ?? reservation.secondsLate ?? null,
        })
        setPopupOpen(true)
      }
      return
    }

    // OCCUPIED / AWAITING_GUEST → popup with currentReservation.
    const overlay = liveByTableId[table.id]
    const reservation = overlay?.currentReservation || overlay?.nextReservation
    if (!reservation) return
    setPopupReservation({
      ...reservation,
      // table.status threads into the popup so its actionsForStatus
      // helper can derive the AwaitingGuest action set (Seat + No-show)
      // even though the reservation's own status is CONFIRMED /
      // AUTO_CONFIRMED — see ReservationDetailPopup's isAwaitingGuestDerived.
      table: { id: table.id, tableNumber: table.tableNumber, seatCount: table.seatCount, status: table.status },
      // secondsLate is the Dashboard-summary equivalent of the same
      // signal; pass it through too so the derivation works regardless
      // of which path supplied the data.
      secondsLate: overlay?.secondsLate ?? reservation.secondsLate ?? null,
    })
    setPopupOpen(true)
  }

  const handleStatusChange = async () => {
    if (!selectedTable) return
    try {
      await apiPut(`/api/restaurant/tables/${selectedTable.id}/status`, { status: newStatus })
      setShowModal(false)
      setSelectedTable(null)
      loadLayout()
    } catch (err) {
      alert('Failed to update table status: ' + err.message)
    }
  }

  const handleSeatWalkIn = async () => {
    if (!selectedTable) return
    try {
      await apiPut(`/api/restaurant/tables/${selectedTable.id}/seat`, { guestCount })
      setShowModal(false)
      setSelectedTable(null)
      loadLayout()
    } catch (err) {
      alert('Failed to seat walk-in: ' + err.message)
    }
  }

  const currentSection = sections.find(s => s.id === activeSection)
  const tables = currentSection?.tables || []

  if (loading) {
    return <div className="text-center py-12">Loading floor plan...</div>
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Live Floor Plan</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Confirm-mode banner */}
      {confirmReservationId && confirmReservation && (
        <div className="mb-6 p-4 bg-primary-bg border-2 border-primary rounded-lg flex justify-between items-center">
          <div>
            <p className="font-bold text-primary">
              Confirming reservation for{' '}
              {confirmReservation.guestName
                || (confirmReservation.user
                  ? `${confirmReservation.user.firstName} ${confirmReservation.user.lastName}`
                  : 'guest')}
            </p>
            <p className="text-sm text-gray-700">
              Party of {confirmReservation.partySize} at {confirmReservation.time}
              {' — '}
              {eligibleTableIds && eligibleTableIds.size > 0
                ? `${eligibleTableIds.size} eligible table${eligibleTableIds.size === 1 ? '' : 's'} highlighted`
                : 'no eligible tables available'}
            </p>
          </div>
          <button
            onClick={exitConfirmMode}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 bg-white"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="mb-6 bg-white rounded-lg shadow p-4">
        <h3 className="font-bold mb-3">Legend</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(statusColors).map(([status, colors]) => (
            <div key={status} className="flex items-center gap-2">
              <div className={`w-6 h-6 border-2 rounded ${colors.border} ${colors.bg}`}></div>
              <span className="text-sm">{colors.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Section Tabs */}
      <div className="mb-6 bg-white rounded-lg shadow">
        <div className="flex border-b">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`px-6 py-3 font-medium transition-colors ${
                activeSection === section.id
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {section.nameEn || section.nameRo}
            </button>
          ))}
        </div>
      </div>

      {/* Table Grid */}
      <div className="bg-white rounded-lg shadow p-6">
        {tables.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No tables in this section</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${currentSection.gridColumns || 6}, minmax(0, 1fr))`,
              gap: '8px',
            }}
          >
            {Array.from({ length: currentSection.gridRows || 4 }).map((_, row) =>
              Array.from({ length: currentSection.gridColumns || 6 }).map((_, col) => {
                const table = tables.find(
                  (t) => t.gridRow === row && t.gridCol === col
                )
                if (table) {
                  const colors = statusColors[table.status] || statusColors.FREE
                  const inConfirmMode = !!confirmReservationId
                  const isEligible = inConfirmMode && eligibleTableIds && eligibleTableIds.has(table.id)
                  const dimmed = inConfirmMode && !isEligible
                  const overlay = liveByTableId[table.id]
                  // ARRIVING_SOON shows the upcoming reservation;
                  // OCCUPIED + AWAITING_GUEST show whoever is at (or due at)
                  // the table now. Falls back across the two slots so a
                  // mid-transition table doesn't lose its label.
                  const overlayRes =
                    table.status === 'ARRIVING_SOON'
                      ? (overlay?.nextReservation || overlay?.currentReservation)
                      : (overlay?.currentReservation || overlay?.nextReservation)
                  const showOverlay = !inConfirmMode && OVERLAY_STATUSES.has(table.status) && overlayRes
                  return (
                    <button
                      key={`${row}-${col}`}
                      onClick={() => {
                        if (inConfirmMode) {
                          if (isEligible) handleAssignFromConfirm(table)
                        } else {
                          handleTableClick(table)
                        }
                      }}
                      disabled={dimmed}
                      className={`border-2 rounded-lg p-2 transition-all min-h-[80px] flex flex-col items-stretch justify-between text-left ${
                        dimmed ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:shadow-lg'
                      } ${
                        isEligible ? 'ring-4 ring-primary ring-offset-2' : ''
                      } ${colors.bg} ${colors.border} ${colors.text}`}
                    >
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-base font-bold leading-none">{table.tableNumber}</span>
                        <span className="text-[10px] opacity-70 leading-none">{table.seatCount}</span>
                      </div>
                      {showOverlay ? (
                        <>
                          <div className="text-xs font-semibold mt-1 leading-tight flex items-center gap-1 min-w-0">
                            <span className="truncate">{truncateGuestName(overlayRes.guestName)}</span>
                            {overlayRes.partySize != null && (
                              <span className="opacity-75 shrink-0">{t('liveOverlay.party', { count: overlayRes.partySize })}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-1 mt-0.5">
                            <span className="text-[11px] opacity-80">{overlayRes.time || ''}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <SpecialRequestsBadge
                                hasSpecialRequests={overlayRes.hasSpecialRequests}
                                className="text-sm"
                              />
                              <MinLateBadge secondsLate={overlay?.secondsLate} />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] mt-1 opacity-75">{colors.label}</div>
                      )}
                    </button>
                  )
                }
                return (
                  <div
                    key={`${row}-${col}`}
                    className="border border-dashed border-gray-200 rounded-lg min-h-[80px]"
                  />
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && selectedTable && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">{selectedTable.tableNumber}</h2>
              <div className="mb-4 text-sm text-gray-600">
                <p>Capacity: {selectedTable.seatCount} seats</p>
                <p>Current Status: {statusColors[selectedTable.status].label}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Change Status</label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full"
                  >
                    <option value="FREE">Free</option>
                    <option value="OCCUPIED">Occupied</option>
                    <option value="ARRIVING_SOON">Arriving Soon</option>
                    <option value="AWAITING_GUEST">Awaiting Guest</option>
                    <option value="OUT_OF_SERVICE">Out of Service</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Seat Walk-In (Guests)</label>
                  <input
                    type="number"
                    min="1"
                    value={guestCount}
                    onChange={(e) => setGuestCount(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={handleStatusChange}
                    className="flex-1 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark transition-colors"
                  >
                    Update Status
                  </button>
                  <button
                    onClick={handleSeatWalkIn}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Seat Walk-In
                  </button>
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 text-sm text-gray-500 flex items-center justify-between">
        <span>Auto-refreshes every 30 seconds</span>
        {lastRefresh && (
          <span>Last updated: {formatTime(lastRefresh.toISOString())}</span>
        )}
      </div>

      {/* Shared ReservationDetailPopup (Phase 2). Opens when staff taps an
          Occupied / Arriving Soon / Awaiting Guest table. Free + OOS taps
          are no-ops in P3-3; Free becomes the walk-in trigger in P3-4.
          onAction is wired to the existing reservation routes — for the
          actions the popup exposes, the page falls back to a refetch so
          the overlay stays consistent without page-specific handlers. */}
      <ReservationDetailPopup
        reservation={popupReservation}
        isOpen={popupOpen}
        onClose={() => { setPopupOpen(false); setPopupReservation(null) }}
        onAction={(actionType, reservation) => {
          // Phase 3-3 scope: render-only popup. The action handlers
          // (confirm/cancel/seat/edit/etc.) land in subsequent P3-* items
          // (P3-5 no-show with undo, P3-6 edit). For now, close the popup
          // and trigger a refetch so the overlay reflects whatever the
          // backend ends up doing via other paths.
          setPopupOpen(false)
          setPopupReservation(null)
          loadLayout(true)
        }}
      />

      {/* Walk-in action sheet (P3-4). Local socket sub will pick up the
          walkin:created + table:status-changed events the backend emits
          on save, so we don't need to refetch — but doing so quietly is
          cheap insurance against any payload-shape mismatch. */}
      <WalkInActionSheet
        table={walkInTable}
        isOpen={!!walkInTable}
        arrivingSoonWarning={walkInArrivingWarning}
        onClose={() => { setWalkInTable(null); setWalkInArrivingWarning(null) }}
        onSeated={() => { loadLayout(true) }}
      />
    </div>
  )
}
