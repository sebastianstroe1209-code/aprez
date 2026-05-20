'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiGet, apiPut, apiPost } from '../../../lib/api'
import { formatTime } from '../../../lib/format'
import { subscribe } from '../../../lib/socket'
import { useSocketRefetch } from '../../../lib/useSocketRefetch'
import ReservationDetailPopup from '../../../components/ReservationDetailPopup'
import WalkInActionSheet from '../../../components/WalkInActionSheet'
import OverrideModal from '../../../components/OverrideModal'
import ServicePeriodFilter from '../../../components/ServicePeriodFilter'
import SpecialRequestsBadge from '../../../components/ui/SpecialRequestsBadge'
import MinLateBadge from '../../../components/ui/MinLateBadge'
import { useToast } from '../../../components/ui/ToastProvider'
import { computeLiveGridLayout } from '../../../lib/liveGridLayout'
import { timeInPeriod } from '../../../lib/servicePeriod'

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

// Tier I commit 2 — cap surfaced for client-side pre-check of the 5th-
// member drop so we don't waste a server round-trip when the UI knows
// the merge would exceed the limit. Server still enforces.
const MERGE_CAP = 4

export default function LiveFloorPlanPage() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { show: showToast } = useToast()
  const confirmReservationId = searchParams.get('confirmReservationId')

  const [sections, setSections] = useState([])
  // liveByTableId: { [tableId]: { currentReservation, nextReservation,
  // secondsLate, occupancyDurationMin } } — augmented per-table data
  // from the C6 Phase 1 amended /layout/live endpoint. Merged into the
  // section/grid structure (which still comes from /layout) at render
  // time so we don't lose the grid coordinates.
  const [liveByTableId, setLiveByTableId] = useState({})
  const [activeSection, setActiveSection] = useState(null)
  // Tier G4 (§6.3) — service-period time filter. servicePeriods is
  // fetched once from /profile; selectedPeriodId '' = "All periods".
  const [servicePeriods, setServicePeriods] = useState([])
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
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

  // Tier I commit 2 — drag-merge state. `dragSourceId` is the id of the
  // table whose handle initiated the drag; `dragHover` is the cell the
  // cursor is currently over (so we can tint valid targets without
  // re-rendering the whole grid on every dragover). `overrideInfo`
  // holds the 409 body when an assign-table call needs the override
  // confirm modal. `mergeWorking` is set while a merge POST is in
  // flight so we can disable subsequent drops.
  const [dragSourceId, setDragSourceId] = useState(null)
  const [dragHover, setDragHover] = useState(null) // { row, col }
  const [overrideInfo, setOverrideInfo] = useState(null) // 409 body
  const [pendingOverrideAssign, setPendingOverrideAssign] = useState(null) // { reservationId, tableId, isConfirmFlow }
  const [mergeWorking, setMergeWorking] = useState(false)

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

  // Tier G4 (§6.3) — service periods for the floor-plan time filter.
  // Fetched once on mount; they change rarely (admin-managed).
  useEffect(() => {
    apiGet('/api/restaurant/profile')
      .then((p) => setServicePeriods(p?.servicePeriods || []))
      .catch(() => {})
  }, [])

  // Tier I commit 2 — refetch the layout on merge/unmerge events so the
  // spanning card appears/disappears across all open tabs. Reusing the
  // same socket subscriber pattern as the C4 reservation events.
  useEffect(() => {
    const onMergeChange = () => loadLayout(true)
    const unsubs = [
      subscribe('table:merged', onMergeChange),
      subscribe('table:unmerged', onMergeChange),
    ]
    return () => unsubs.forEach((fn) => fn())
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

  // Tier I commit 2 — assign-from-confirm now wraps the apiPut and
  // surfaces 409 `party-too-large` via the standalone OverrideModal
  // (decision 7). On confirm the modal re-POSTs with force: true.
  // Pre-Tier-I this alerted the raw error message; the modal gives
  // staff a localized confirm flow per SPEC §8.2 override path.
  const handleAssignFromConfirm = async (table, opts = {}) => {
    if (!confirmReservation) return
    const force = !!opts.force
    try {
      const status = confirmReservation.status
      const path = status === 'PENDING'
        ? `/api/restaurant/reservations/${confirmReservation.id}/confirm`
        : `/api/restaurant/reservations/${confirmReservation.id}/assign-table`
      await apiPut(path, { tableId: table.id, ...(force ? { force: true } : {}) })
      // Success — close override modal if it was open, exit confirm mode.
      setOverrideInfo(null)
      setPendingOverrideAssign(null)
      if (force) {
        showToast(t('override.successToast', { tableLabel: table.tableNumber }), { variant: 'success' })
      }
      router.push('/dashboard/live')
      loadLayout()
    } catch (err) {
      // lib/api.js attaches the parsed payload on err.payload (added in
      // Tier F2). Confirm endpoint returns 200 on success and won't go
      // through this path for party-too-large; only /assign-table fires
      // the structured 409.
      const info = err?.payload?.error
      if (info && info.code === 'party-too-large') {
        setOverrideInfo(info)
        setPendingOverrideAssign({ table })
        return
      }
      alert('Failed to assign table: ' + err.message)
    }
  }

  // OverrideModal "Assign anyway" → re-call assign with force=true.
  const handleOverrideConfirm = async () => {
    if (!pendingOverrideAssign) return
    await handleAssignFromConfirm(pendingOverrideAssign.table, { force: true })
  }
  const handleOverrideCancel = () => {
    setOverrideInfo(null)
    setPendingOverrideAssign(null)
  }

  // Tier I commit 2 — drag-merge handlers.
  //
  // Adjacency check: any member of the would-be group (source's merge
  // members + target) must be within Manhattan-1 of another member.
  // Conservative client-side check — server has the authoritative BFS.
  const isManhattanAdjacent = (a, b) =>
    Math.abs(a.gridRow - b.gridRow) + Math.abs(a.gridCol - b.gridCol) === 1

  // Default time window for a drag-initiated merge: now → end of business
  // day (23:59 Europe/Bucharest). When a reservation is in confirm-mode,
  // we bind to that reservation instead (its time window + reservationId).
  const defaultMergeWindow = () => {
    const now = new Date()
    const buchHm = now.toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
    return { date: today, timeStart: buchHm, timeEnd: '23:59' }
  }

  // Tier I fix-the-fix #3 — declare derived state HERE (before any
  // useCallback whose dep array references it) so we don't hit a
  // ReferenceError TDZ on the very first render. Pre-#3 these lived
  // after the handlers and the handlers' deps (`tables`,
  // `liveByTableId`) tripped a "Cannot access 'tables' before
  // initialization" runtime error on every confirm-mode mount.
  // The render-perf intent of fix #2 stays intact — only the
  // declaration order moves.
  const currentSection = sections.find(s => s.id === activeSection)
  const tables = currentSection?.tables || []

  // Tier G4 (§6.3) — resolved service-period object for the floor-plan
  // time filter. null when "All periods" is selected (no filtering).
  const selectedPeriod = servicePeriods.find((p) => p.id === selectedPeriodId) || null

  // Memoized merge-layout helper (extracted to lib/liveGridLayout.js).
  // Inputs: tables + liveByTableId. Transient state changes (drag
  // hover, modal open/close, popup) don't recompute. See
  // server/.smoke/c6-live-grid-layout-test.js for the purity + O(N)
  // perf guard.
  const gridLayout = useMemo(
    () => computeLiveGridLayout(tables, liveByTableId),
    [tables, liveByTableId]
  )

  // Hoist per-cell tooltip translations once per render so we don't
  // call t() once per cell in the render loop. next-intl's t() is
  // cheap but in a 30-cell × multi-render storm it adds up.
  const overrideTinyHint = t('override.tinyHint')
  const dragHandleTooltip = t('merge.handleTooltip')

  // Tier I commit 2 fix-the-fix #2 — useCallback on drag handlers so
  // the per-cell onDragOver/onDragLeave/onDrop wrappers don't get new
  // function references on every parent re-render. Combined with the
  // useMemo'd grid layout above, this kills the per-render thrash that
  // Cowork QA caught (renderer hang on subsequent state changes in
  // confirm-mode).
  const handleDragStart = useCallback((e, table) => {
    setDragSourceId(table.id)
    try { e.dataTransfer.setData('text/plain', table.id); e.dataTransfer.effectAllowed = 'move' } catch (_) {}
  }, [])
  const handleDragEnd = useCallback(() => {
    setDragSourceId(null)
    setDragHover(null)
  }, [])
  const handleDragOver = useCallback((e, target) => {
    if (!dragSourceId || !target?.table) return
    const source = tables.find((t) => t.id === dragSourceId)
    if (!source || source.id === target.table.id) return
    if (!isManhattanAdjacent(source, target.table)) return
    // 4-cap pre-check: if either side is already a merge, refuse
    // when the union would exceed MERGE_CAP.
    const sourceMerge = liveByTableId[source.id]?.merge
    const targetMerge = liveByTableId[target.table.id]?.merge
    const sourceCount = sourceMerge?.members?.length || 1
    const targetCount = targetMerge?.members?.length || 1
    const sameGroup = sourceMerge?.groupId && sourceMerge.groupId === targetMerge?.groupId
    if (!sameGroup && sourceCount + targetCount > MERGE_CAP) return
    if (sameGroup) return // already merged together → nothing to do
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragHover({ row: target.table.gridRow, col: target.table.gridCol })
  }, [dragSourceId, tables, liveByTableId])
  const handleDragLeave = useCallback((e, target) => {
    if (dragHover && target?.table &&
      dragHover.row === target.table.gridRow && dragHover.col === target.table.gridCol) {
      setDragHover(null)
    }
  }, [dragHover])
  const handleDrop = async (e, target) => {
    e.preventDefault()
    setDragHover(null)
    const sourceId = e.dataTransfer.getData('text/plain') || dragSourceId
    setDragSourceId(null)
    if (!sourceId || !target?.table || sourceId === target.table.id || mergeWorking) return
    const source = tables.find((t) => t.id === sourceId)
    if (!source) return

    // Re-validate client-side before sending.
    if (!isManhattanAdjacent(source, target.table)) {
      showToast(t('merge.errorNotAdjacent'), { variant: 'warning' })
      return
    }
    const sourceMerge = liveByTableId[source.id]?.merge
    const targetMerge = liveByTableId[target.table.id]?.merge
    if (sourceMerge?.groupId && sourceMerge.groupId === targetMerge?.groupId) return

    // Compose the union of (source's group members) + (target's group
    // members) + standalone if either was solo.
    const memberIds = new Set()
    if (sourceMerge?.members?.length) sourceMerge.members.forEach((m) => memberIds.add(m.id))
    else memberIds.add(source.id)
    if (targetMerge?.members?.length) targetMerge.members.forEach((m) => memberIds.add(m.id))
    else memberIds.add(target.table.id)
    if (memberIds.size > MERGE_CAP) {
      showToast(t('merge.errorCap', { max: MERGE_CAP }), { variant: 'warning' })
      return
    }

    // Reservation-bound or pre-merge?
    const tw = (() => {
      if (confirmReservation?.time && confirmReservation?.endTime) {
        const date = typeof confirmReservation.date === 'string'
          ? confirmReservation.date.slice(0, 10)
          : new Date(confirmReservation.date).toISOString().slice(0, 10)
        return {
          date,
          timeStart: confirmReservation.time,
          timeEnd: confirmReservation.endTime,
          reservationId: confirmReservation.id,
        }
      }
      return defaultMergeWindow()
    })()

    setMergeWorking(true)
    try {
      const res = await apiPost('/api/restaurant/tables/merge', {
        tableIds: [...memberIds],
        ...tw,
      })
      showToast(t('merge.mergedToast', { label: res.combinedLabel }), { variant: 'success' })
      loadLayout(true)
    } catch (err) {
      const info = err?.payload?.error
      const code = info?.code
      if (code === 'not-adjacent') showToast(t('merge.errorNotAdjacent'), { variant: 'warning' })
      else if (code === 'merge-cap-exceeded') showToast(t('merge.errorCap', { max: MERGE_CAP }), { variant: 'warning' })
      else if (code === 'member-not-mergeable' && info?.blocked?.[0]) {
        showToast(t('merge.errorOccupied', { tableLabel: info.blocked[0].tableNumber, status: info.blocked[0].status }), { variant: 'warning' })
      }
      else if (code === 'merge-window-conflict') showToast(t('merge.errorWindowConflict'), { variant: 'warning' })
      else if (code === 'reservation-conflict') showToast(t('merge.errorReservationConflict'), { variant: 'warning' })
      else if (code === 'cross-section-merge') showToast(t('merge.errorCrossSection'), { variant: 'warning' })
      else showToast(t('merge.errorGeneric'), { variant: 'error' })
    } finally {
      setMergeWorking(false)
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
          // Tier I commit 2 — merge sub-object shipped on /layout/live
          // in I1. Threaded into the per-table view here so the render
          // path can compose merge cards in pass 1.
          merge: tbl.merge || null,
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
      // Tier I commit 2 — thread the merge sub-object so the popup
      // shows the combined label/seats header AND so popupActions
      // appends 'unmerge' to the action set.
      merge: overlay?.merge || null,
    })
    setPopupOpen(true)
  }

  // Tier I commit 2 — click handler for a merged spanning card. Routes
  // to the popup with whichever member's reservation is "live" (current
  // > next > any member's currentReservation). Same shape the standalone
  // handler produces, just with the merge sub-object threaded.
  const handleMergeClick = (merge) => {
    if (!merge?.members?.length) return
    // Find the member whose overlay has a currentReservation; fall back
    // to next; fall back to any member's tableNumber for a placeholder.
    let pickedTable = null
    let reservation = null
    for (const m of merge.members) {
      const ov = liveByTableId[m.id]
      if (!ov) continue
      if (ov.currentReservation) {
        pickedTable = tables.find((t) => t.id === m.id) || m
        reservation = ov.currentReservation
        break
      }
    }
    if (!reservation) {
      for (const m of merge.members) {
        const ov = liveByTableId[m.id]
        if (ov?.nextReservation) {
          pickedTable = tables.find((t) => t.id === m.id) || m
          reservation = ov.nextReservation
          break
        }
      }
    }
    // Empty-merge placeholder: synthesize a minimal reservation-shaped
    // object so the popup can render header/Unmerge even when no booking
    // owns the merge yet. Status set to AUTO_CONFIRMED so the default
    // action set is empty + Unmerge gets appended.
    if (!reservation) {
      pickedTable = tables.find((t) => t.id === merge.members[0].id) || merge.members[0]
      reservation = {
        id: null,
        guestName: merge.combinedLabel,
        partySize: merge.summedSeatCount,
        time: '', endTime: '',
        status: 'AUTO_CONFIRMED',
        seatedAt: null,
      }
    }
    setPopupReservation({
      ...reservation,
      table: pickedTable ? {
        id: pickedTable.id,
        tableNumber: pickedTable.tableNumber,
        seatCount: pickedTable.seatCount,
        status: pickedTable.status,
      } : null,
      secondsLate: liveByTableId[pickedTable?.id]?.secondsLate ?? null,
      merge,
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

  if (loading) {
    return <div className="text-center py-12">Loading floor plan...</div>
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Live Floor Plan</h1>

      {error && (
        <div className="mb-6 p-4 bg-alert-error-bg border border-alert-error-border text-alert-error-fg rounded">
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

      {/* Service-period filter (Tier G4 — §6.3) */}
      {servicePeriods.length > 0 && (
        <div className="mb-6 bg-white rounded-lg shadow p-4">
          <ServicePeriodFilter
            periods={servicePeriods}
            value={selectedPeriodId}
            onChange={setSelectedPeriodId}
          />
        </div>
      )}

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

      {/* Table Grid — Tier I commit 2 two-pass render.
          Pass 1 emits one spanning card per active merge group; pass 2
          emits standalone tables + empty placeholders, skipping cells
          claimed by a merge.

          Layout invariants defended (per audit + decisions):
          - Card min-height ≥80px on standalone + merged cards.
          - Each cell owned by exactly one merge group or one standalone
            table (server enforces; client trusts).
          - 5th-member drop blocked client-side via onDragOver (server
            still backs it).
          - L-shaped merges (members ≠ rect bounding-box area) fall back
            to per-member cards with shared border to avoid claiming a
            phantom corner cell. Rect merges use gridColumn/gridRow span. */}
      <div className="bg-white rounded-lg shadow p-6">
        {tables.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No tables in this section</div>
        ) : (
          (() => {
            // Tier I commit 2 fix-the-fix #2 — merge-layout extracted
            // to useMemo above (computeLiveGridLayout). This IIFE now
            // only constructs the JSX tree; no per-render Map/Set
            // allocation, no per-render bbox math.
            const { mergeGroups, claimedCells } = gridLayout
            return (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${currentSection.gridColumns || 6}, minmax(0, 1fr))`,
                  gridAutoRows: 'minmax(80px, auto)',
                  gap: '8px',
                }}
              >
                {/* Pass 1: rect-merge spanning cards. CSS grid is 1-indexed. */}
                {mergeGroups.filter((e) => e.isRect).map((entry) => {
                  const { merge, bbox, dominantStatus } = entry
                  const inConfirmMode = !!confirmReservationId
                  // For confirm-mode highlighting, treat the merge as
                  // eligible if any member is in eligibleTableIds.
                  const isEligible = inConfirmMode && eligibleTableIds &&
                    entry.memberRecords.some((tbl) => eligibleTableIds.has(tbl.id))
                  const colors = statusColors[dominantStatus] || statusColors.FREE
                  // Tier I commit 2 fix-the-fix — soft-eligibility split.
                  // hard-disable only OCCUPIED + OUT_OF_SERVICE; capacity-only
                  // ineligibility (effective seats < partySize) stays clickable
                  // so the click can route through the 409 path → OverrideModal.
                  const hardDisabled = dominantStatus === 'OCCUPIED' || dominantStatus === 'OUT_OF_SERVICE'
                  const tooSmall = inConfirmMode && confirmReservation &&
                    merge.summedSeatCount < confirmReservation.partySize
                  const conflictIneligible = inConfirmMode && !isEligible && !hardDisabled && !tooSmall
                  const softIneligible = inConfirmMode && !isEligible && !hardDisabled && tooSmall
                  const effectivelyDisabled = hardDisabled || conflictIneligible
                  return (
                    <button
                      key={`merge-${merge.groupId}`}
                      onClick={() => {
                        if (inConfirmMode) {
                          // Eligible OR soft-ineligible (party-too-large
                          // override path) both route through assign;
                          // conflictIneligible + hardDisabled are no-ops.
                          if (isEligible || softIneligible) handleAssignFromConfirm(entry.memberRecords[0])
                        } else {
                          handleMergeClick(merge)
                        }
                      }}
                      disabled={effectivelyDisabled}
                      style={{
                        gridColumn: `${bbox.minC + 1} / span ${bbox.colSpan}`,
                        gridRow: `${bbox.minR + 1} / span ${bbox.rowSpan}`,
                      }}
                      className={`relative border-2 rounded-lg p-2 transition-all min-h-[80px] flex flex-col items-stretch justify-between text-left ring-2 ${
                        effectivelyDisabled ? 'opacity-40 cursor-not-allowed border-amber-500 ring-amber-300' : 'cursor-pointer hover:shadow-lg'
                      } ${
                        softIneligible ? 'border-dashed border-orange-400 ring-orange-200 bg-orange-50/60' : 'border-amber-500 ring-amber-300'
                      } ${colors.bg} ${colors.text}`}
                      title={softIneligible
                        ? t('override.tooltipHint', { partySize: confirmReservation?.partySize, seatCount: merge.summedSeatCount })
                        : t('merge.headerLabel', { label: merge.combinedLabel, seats: merge.summedSeatCount })}
                    >
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-base font-bold leading-none text-amber-900">★ {merge.combinedLabel}</span>
                        <span className="text-[10px] opacity-70 leading-none">{merge.summedSeatCount} seats</span>
                      </div>
                      <div className="text-[10px] mt-1 opacity-75">{colors.label}</div>
                      {softIneligible && (
                        <div className="text-[10px] mt-0.5 text-orange-700 font-semibold">{overrideTinyHint}</div>
                      )}
                    </button>
                  )
                })}

                {/* Pass 1b: L-shape fallback — per-member with shared border. */}
                {mergeGroups.filter((e) => !e.isRect).flatMap((entry) =>
                  entry.memberRecords.map((tbl, idx) => {
                    const colors = statusColors[tbl.status] || statusColors.FREE
                    const inConfirmMode = !!confirmReservationId
                    const isEligible = inConfirmMode && eligibleTableIds && eligibleTableIds.has(tbl.id)
                    const dimmed = inConfirmMode && !isEligible
                    return (
                      <button
                        key={`linked-${entry.merge.groupId}-${tbl.id}`}
                        onClick={() => {
                          if (inConfirmMode) {
                            if (isEligible) handleAssignFromConfirm(tbl)
                          } else {
                            handleMergeClick(entry.merge)
                          }
                        }}
                        disabled={dimmed}
                        style={{
                          gridColumn: `${tbl.gridCol + 1}`,
                          gridRow: `${tbl.gridRow + 1}`,
                        }}
                        className={`relative border-2 border-amber-500 rounded-lg p-2 transition-all min-h-[80px] flex flex-col items-stretch justify-between text-left ring-2 ring-amber-300 ${
                          dimmed ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:shadow-lg'
                        } ${colors.bg} ${colors.text}`}
                        title={t('merge.memberOf', { label: entry.merge.combinedLabel })}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-base font-bold leading-none">
                            {idx === 0 ? `★ ${entry.merge.combinedLabel}` : tbl.tableNumber}
                          </span>
                        </div>
                        <div className="text-[10px] mt-1 opacity-75">{colors.label}</div>
                      </button>
                    )
                  })
                )}

                {/* Pass 2: standalone tables + empty placeholders, skipping
                    cells claimed by a merge in pass 1. */}
                {Array.from({ length: currentSection.gridRows || 4 }).map((_, row) =>
                  Array.from({ length: currentSection.gridColumns || 6 }).map((_, col) => {
                    if (claimedCells.has(`${row},${col}`)) return null
                    const table = tables.find((t) => t.gridRow === row && t.gridCol === col)
                    if (table) {
                      const colors = statusColors[table.status] || statusColors.FREE
                      const inConfirmMode = !!confirmReservationId
                      const isEligible = inConfirmMode && eligibleTableIds && eligibleTableIds.has(table.id)
                      // Tier I commit 2 fix-the-fix — same soft-eligibility split
                      // as the merge spanning card. Only OCCUPIED + OUT_OF_SERVICE
                      // are hard-disabled; too-small tables stay clickable so the
                      // 409 → OverrideModal path is reachable. Time-conflict
                      // ineligibility (table is large enough but already booked
                      // for the slot) stays hard-disabled — no override exists
                      // for that case in the current backend.
                      const hardDisabled = table.status === 'OCCUPIED' || table.status === 'OUT_OF_SERVICE'
                      const tooSmall = inConfirmMode && confirmReservation &&
                        table.seatCount < confirmReservation.partySize
                      const conflictIneligible = inConfirmMode && !isEligible && !hardDisabled && !tooSmall
                      const softIneligible = inConfirmMode && !isEligible && !hardDisabled && tooSmall
                      const dimmed = hardDisabled || conflictIneligible
                      const overlay = liveByTableId[table.id]
                      const overlayRes =
                        table.status === 'ARRIVING_SOON'
                          ? (overlay?.nextReservation || overlay?.currentReservation)
                          : (overlay?.currentReservation || overlay?.nextReservation)
                      // Tier G4 (§6.3): with a service period selected,
                      // suppress the guest overlay on tables whose
                      // reservation falls outside that window — the card
                      // still renders, just status-only.
                      const showOverlay = !inConfirmMode && OVERLAY_STATUSES.has(table.status) && overlayRes
                        && (!selectedPeriod || timeInPeriod(overlayRes.time, selectedPeriod))
                      const isDropTarget = dragHover && dragHover.row === row && dragHover.col === col
                      const isDragSource = dragSourceId === table.id
                      // Drag handle only on non-OCCUPIED, non-OOS tables
                      // (matches the server's merge-eligibility rule).
                      const canDrag = !inConfirmMode && table.status !== 'OCCUPIED' && table.status !== 'OUT_OF_SERVICE'
                      return (
                        <div
                          key={`cell-${row}-${col}`}
                          style={{ gridColumn: `${col + 1}`, gridRow: `${row + 1}` }}
                          onDragOver={(e) => handleDragOver(e, { table })}
                          onDragLeave={(e) => handleDragLeave(e, { table })}
                          onDrop={(e) => handleDrop(e, { table })}
                          className={`relative ${isDropTarget ? 'ring-4 ring-amber-400 ring-offset-1 rounded-lg' : ''}`}
                        >
                          <button
                            onClick={() => {
                              if (inConfirmMode) {
                                // Soft-ineligible (party-too-large) routes
                                // through assign so the 409 → OverrideModal
                                // fires. Hard-disable + conflict-ineligible
                                // are no-ops via the `disabled` attribute.
                                if (isEligible || softIneligible) handleAssignFromConfirm(table)
                              } else {
                                handleTableClick(table)
                              }
                            }}
                            disabled={dimmed || mergeWorking}
                            title={softIneligible
                              ? t('override.tooltipHint', { partySize: confirmReservation?.partySize, seatCount: table.seatCount })
                              : undefined}
                            className={`w-full border-2 rounded-lg p-2 transition-all min-h-[80px] flex flex-col items-stretch justify-between text-left ${
                              dimmed ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:shadow-lg'
                            } ${
                              isEligible ? 'ring-4 ring-primary ring-offset-2' : ''
                            } ${
                              softIneligible ? 'border-dashed border-orange-400 ring-2 ring-orange-200 bg-orange-50/60' : ''
                            } ${isDragSource ? 'opacity-60' : ''} ${colors.bg} ${softIneligible ? '' : colors.border} ${colors.text}`}
                          >
                            <div className="flex items-baseline justify-between gap-1">
                              <span className="text-base font-bold leading-none">{table.tableNumber}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] opacity-70 leading-none">{table.seatCount}</span>
                                {/* Tier I commit 2 — drag handle. Native
                                    HTML5 draggable on the handle ONLY so
                                    the parent button's onClick still
                                    opens the popup. stopPropagation on
                                    pointer events keeps the click
                                    handler clean. */}
                                {canDrag && (
                                  <span
                                    role="button"
                                    aria-label={dragHandleTooltip}
                                    title={dragHandleTooltip}
                                    draggable
                                    onDragStart={(e) => { e.stopPropagation(); handleDragStart(e, table) }}
                                    onDragEnd={(e) => { e.stopPropagation(); handleDragEnd() }}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="ml-1 cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-800 leading-none select-none"
                                    style={{ fontSize: '14px' }}
                                  >⠿</span>
                                )}
                              </div>
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
                        </div>
                      )
                    }
                    // Empty placeholder cell. Also a drop target so an
                    // adjacent table can be dragged onto it — though
                    // dragOver will reject if no table is at the cell.
                    return (
                      <div
                        key={`cell-${row}-${col}`}
                        style={{ gridColumn: `${col + 1}`, gridRow: `${row + 1}` }}
                        className="border border-dashed border-gray-200 rounded-lg min-h-[80px]"
                      />
                    )
                  })
                )}
              </div>
            )
          })()
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
                    className="flex-1 px-4 py-2 bg-action-info text-white rounded hover:bg-action-info-hover transition-colors"
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

      {/* Tier I commit 2 — standalone party-too-large override modal,
          triggered by 409 from PUT /reservations/:id/assign-table. */}
      {overrideInfo && (
        <OverrideModal
          info={overrideInfo}
          onCancel={handleOverrideCancel}
          onConfirm={handleOverrideConfirm}
        />
      )}
    </div>
  )
}
