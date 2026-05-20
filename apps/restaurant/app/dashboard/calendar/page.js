'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiGet } from '../../../lib/api'
import { subscribe } from '../../../lib/socket'
import { useSocketRefetch } from '../../../lib/useSocketRefetch'
import { useToast } from '../../../components/ui/ToastProvider'
import CalendarNowIndicator from '../../../components/CalendarNowIndicator'
import ReservationDetailPopup from '../../../components/ReservationDetailPopup'
import QuickAddReservation from '../../../components/QuickAddReservation'
import SpecialRequestsBadge from '../../../components/ui/SpecialRequestsBadge'
import ServicePeriodFilter from '../../../components/ServicePeriodFilter'
import { timeInPeriod } from '../../../lib/servicePeriod'

// SPEC §11: dates handled in Europe/Bucharest. en-CA returns YYYY-MM-DD.
const todayBucharest = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })

// Tier H4 (§6.4) — the Calendar's default date is tomorrow (today belongs
// to the Live floor plan). Treats the Bucharest calendar date as a plain
// date and advances one day.
const tomorrowBucharest = () => {
  const d = new Date(`${todayBucharest()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default function CalendarPage() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { show: showToast } = useToast()
  // Tier H4 (§6.4) — Calendar is the past+future planning view; today is
  // owned by Live. Default date is tomorrow; an explicit ?date= URL param
  // (shareable link, QuickAdd's date-prefill flow) still wins.
  const [selectedDate, setSelectedDate] = useState(
    () => searchParams.get('date') || tomorrowBucharest()
  )
  const [sections, setSections] = useState([])
  const [reservations, setReservations] = useState([])
  // Tier H4 — read-only walk-in segments; fetched for past dates only.
  const [walkIns, setWalkIns] = useState([])
  const [activeSection, setActiveSection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Tier H4 (§6.4) — date-relative mode. `isToday` bounces to Live;
  // `isPast` enables walk-in segments and makes empty cells inert.
  const todayStr = todayBucharest()
  const isToday = selectedDate === todayStr
  const isPast = selectedDate < todayStr
  // Tier H2 (§6.4) — service-period view filter, mirrors the Live page.
  // servicePeriods fetched once from /profile; selectedPeriodId '' = all.
  const [servicePeriods, setServicePeriods] = useState([])
  const [selectedPeriodId, setSelectedPeriodId] = useState('')

  // C6 P3-8: ReservationDetailPopup (occupied-cell click) +
  // QuickAddReservation (empty-cell click) both live at page level so
  // any cell can summon them.
  const [popupReservation, setPopupReservation] = useState(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddPrefill, setQuickAddPrefill] = useState(null)

  // Calendar table wrapper ref — passed to CalendarNowIndicator so it
  // can mutate the matching row's DOM directly without re-rendering the
  // whole calendar each minute.
  const gridRef = useRef(null)

  useEffect(() => {
    loadData()
  }, [selectedDate, activeSection])

  // Tier H4 (§6.4) — today is Live's domain: bounce there immediately.
  // `replace` (not push) so the browser Back button can't land back on
  // Calendar-today and re-trigger this redirect in a loop.
  useEffect(() => {
    if (isToday) router.replace('/dashboard/live')
  }, [isToday, router])

  // Tier H2 (§6.4) — service periods for the view filter. Fetched once;
  // admin-managed, change rarely. Mirrors the Live page's /profile fetch.
  useEffect(() => {
    apiGet('/api/restaurant/profile')
      .then((p) => setServicePeriods(p?.servicePeriods || []))
      .catch(() => {})
  }, [])

  // C4 real-time reservation updates (§5a). Surgical merge keyed on id; only
  // reservations matching the currently selected date stay in view.
  useEffect(() => {
    const matchesSelectedDate = (r) => {
      const resDate = typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10)
      return resDate === selectedDate
    }
    const upsert = (r) => {
      if (!r?.id) return
      setReservations((list) => {
        const idx = list.findIndex((x) => x.id === r.id)
        if (idx === -1) {
          return matchesSelectedDate(r) ? [...list, r] : list
        }
        const merged = { ...list[idx], ...r }
        if (!matchesSelectedDate(merged)) {
          return list.filter((_, i) => i !== idx)
        }
        const next = list.slice()
        next[idx] = merged
        return next
      })
    }
    const onCancelled = (payload) => {
      if (!payload?.id) return
      setReservations((list) => list.filter((r) => r.id !== payload.id))
    }
    const unsubs = [
      subscribe('reservation:created', upsert),
      subscribe('reservation:updated', upsert),
      subscribe('reservation:cancelled', onCancelled),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [selectedDate])

  const refetchOnReconnect = useCallback(() => { loadData(true) }, [selectedDate, activeSection])
  useSocketRefetch(refetchOnReconnect)

  // `quiet=true` skips the setLoading(true) toggle so background refetches
  // (socket reconnect / visibilitychange) don't trip the early-return at
  // the top of the render, which would unmount any open block-detail popup
  // mid-click. Initial-mount calls leave quiet=false so the "Loading…"
  // placeholder still shows on first paint.
  const loadData = async (quiet = false) => {
    // Tier H4 — skip the fetch entirely on today; the page is redirecting
    // to Live and renders nothing here.
    if (isToday) return
    try {
      if (!quiet) setLoading(true)
      const [layoutData, resData, walkInData] = await Promise.all([
        apiGet('/api/restaurant/layout'),
        apiGet(`/api/restaurant/reservations?date=${selectedDate}`),
        // Tier H4 — walk-ins exist only for past dates. Non-fatal: a
        // failure here leaves walk-ins empty rather than blanking the
        // whole calendar over secondary, already-settled data.
        isPast
          ? apiGet(`/api/restaurant/walk-ins?date=${selectedDate}`).catch(() => [])
          : Promise.resolve([]),
      ])
      setSections(layoutData)
      if (layoutData.length > 0 && !activeSection) {
        setActiveSection(layoutData[0].id)
      }
      setReservations(resData)
      setWalkIns(walkInData)
    } catch (err) {
      setError(err.message || 'Failed to load calendar')
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  // Generate time slots (15-minute intervals)
  const generateTimeSlots = () => {
    const slots = []
    for (let h = 10; h < 23; h++) {
      for (let m = 0; m < 60; m += 15) {
        slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      }
    }
    return slots
  }

  const timeSlots = generateTimeSlots()
  const currentSection = sections.find(s => s.id === activeSection)
  const tables = currentSection?.tables || []
  // Tier H2 (§6.4) — resolved service-period object; null = "All periods".
  const selectedPeriod = servicePeriods.find((p) => p.id === selectedPeriodId) || null

  const getReservationForTableAndTime = (tableId, time) => {
    return reservations.find(r => {
      if (r.tableId !== tableId) return false
      const resStart = r.time?.substring(0, 5)
      if (!resStart) return false
      // Show reservation at its start time slot only (simplest approach)
      return resStart === time
    })
  }

  // Tier H4 (§6.4) — walk-in segments. Each walk-in's Bucharest
  // minute-of-day range is precomputed once; a cell is "covered" when the
  // walk-in overlaps that 15-minute slot. `isStart` marks the slot that
  // contains startedAt so only that cell carries the label.
  const walkInRanges = walkIns.map((w) => {
    const toMin = (ts) => {
      const hm = new Date(ts).toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
      })
      const [h, m] = hm.split(':').map(Number)
      return h * 60 + m
    }
    const startMin = toMin(w.startedAt)
    return { ...w, startMin, endMin: w.endedAt ? toMin(w.endedAt) : startMin + 1 }
  })
  const getWalkInForCell = (tableId, slotTime) => {
    const [h, m] = slotTime.split(':').map(Number)
    const slotMin = h * 60 + m
    for (const w of walkInRanges) {
      if (w.tableId !== tableId) continue
      if (w.startMin < slotMin + 15 && w.endMin > slotMin) {
        return { walkIn: w, isStart: Math.floor(w.startMin / 15) * 15 === slotMin }
      }
    }
    return null
  }

  // C6 P3-8 click router per §3.10 part b:
  //   - existing reservation → open ReservationDetailPopup
  //   - OUT_OF_SERVICE table → toast warning, no Quick Add
  //   - otherwise (FREE / OCCUPIED / etc.) → open Quick Add prefilled
  //     with the cell's date/time/tableId
  const handleCellClick = (table, time, res) => {
    if (res) {
      setPopupReservation({
        ...res,
        // Include table.status so the popup's actionsForStatus helper
        // can derive AwaitingGuest (Seat + No-show) when the reservation
        // is CONFIRMED/AUTO_CONFIRMED but the table has flipped to
        // AWAITING_GUEST. See ReservationDetailPopup.isAwaitingGuestDerived.
        table: { id: table.id, tableNumber: table.tableNumber, seatCount: table.seatCount, status: table.status },
      })
      setPopupOpen(true)
      return
    }
    // Tier H4 — you can't book in the past; empty past-date cells are
    // inert (no QuickAdd, no toast). Reservation cells above still open
    // the popup so staff can inspect a settled booking.
    if (isPast) return
    if (table.status === 'OUT_OF_SERVICE') {
      showToast(t('calendar.tableOutOfServiceToast'), {
        variant: 'warning',
        durationMs: 3000,
      })
      return
    }
    setQuickAddPrefill({
      date: selectedDate,
      time,
      tableId: table.id,
      tableLabel: table.tableNumber,
    })
    setQuickAddOpen(true)
  }

  // Tier H4 — render nothing while the today→Live redirect resolves, so
  // there is no calendar-grid flash before the navigation completes.
  if (isToday) return null
  if (loading) {
    return <div className="text-center py-12">Loading calendar...</div>
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Calendar View</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="mb-6 bg-white rounded-lg shadow p-4 flex gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Date</label>
          <input
            type="date"
            lang="en-GB"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Section</label>
          <select
            value={activeSection || ''}
            onChange={(e) => setActiveSection(e.target.value)}
            className="w-40"
          >
            <option value="">-- All Sections --</option>
            {sections.map(s => (
              <option key={s.id} value={s.id}>{s.nameEn || s.nameRo}</option>
            ))}
          </select>
        </div>
        {/* Tier H2 (§6.4) — service-period view filter. Self-hides when
            the restaurant has no configured service periods. */}
        <ServicePeriodFilter
          periods={servicePeriods}
          value={selectedPeriodId}
          onChange={setSelectedPeriodId}
        />
      </div>

      {/* Calendar Grid */}
      <div ref={gridRef} className="bg-white rounded-lg shadow overflow-hidden relative">
        {/* CalendarNowIndicator owns its own setInterval and mutates the
            matching <tr data-time="HH:mm"> directly — the parent
            calendar's React tree stays stable across minute ticks. */}
        <CalendarNowIndicator
          containerRef={gridRef}
          selectedDate={selectedDate}
          label={t('calendar.nowIndicator')}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b">
                <th className="px-4 py-3 text-left text-sm font-semibold border-r min-w-20">Time</th>
                {tables.map(table => (
                  <th key={table.id} className="px-2 py-3 text-center text-xs font-semibold border-r min-w-24">
                    {table.tableNumber}
                    <div className="text-gray-500 font-normal text-xs">{table.seatCount} seats</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timeSlots.map(time => (
                <tr key={time} data-time={time} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium border-r bg-gray-50 tabular-nums">{time}</td>
                  {tables.map(table => {
                    const res = getReservationForTableAndTime(table.id, time)
                    const isOos = table.status === 'OUT_OF_SERVICE'
                    // Tier H2 (§6.4) — service-period view filter: the guest
                    // chip renders only when the reservation's start time is
                    // inside the selected period. `res` itself still drives
                    // click routing, so a period-hidden reservation is never
                    // mistaken for a free slot (matches Live's visual-only
                    // filter).
                    const showRes = res && (!selectedPeriod || timeInPeriod(res.time, selectedPeriod))
                    // Tier H4 — read-only walk-in segment (past dates only),
                    // shown when the cell carries no reservation chip.
                    const walkInCell = (!showRes && isPast) ? getWalkInForCell(table.id, time) : null
                    // Clickable when the cell has a reservation (popup) or
                    // the date is future (empty → QuickAdd). Past empty and
                    // walk-in cells are inert.
                    const clickable = !!res || !isPast
                    return (
                      <td
                        key={table.id}
                        onClick={() => handleCellClick(table, time, res)}
                        className={`px-2 py-3 border-r text-center ${
                          clickable ? 'cursor-pointer' : 'cursor-default'
                        } ${isOos && !res ? 'bg-gray-100' : ''}`}
                      >
                        {showRes ? (
                          <div className="bg-primary text-white text-xs p-2 rounded inline-flex items-center gap-1">
                            <span className="font-medium truncate">
                              {res.guestName || (res.user ? `${res.user.firstName} ${res.user.lastName}` : 'Guest')}
                            </span>
                            <SpecialRequestsBadge
                              specialRequests={res.specialRequests}
                              hasSpecialRequests={res.hasSpecialRequests}
                              className="text-amber-200"
                            />
                            <span className="text-[10px] opacity-75 ml-1">×{res.partySize}</span>
                            {/* Tier I commit 3 — merge badge per decision 4.
                                Renders in the first member's column showing
                                only the OTHER member tables ("+T3"). Tooltip
                                surfaces the full combined label. Block stays
                                single-column; no grid math change. */}
                            {res.mergeBinding && res.mergeBinding.otherMemberLabels?.length > 0 && (
                              <span
                                className="ml-1 px-1 rounded bg-amber-400 text-amber-900 text-[10px] font-semibold"
                                title={res.mergeBinding.combinedLabel}
                              >
                                +{res.mergeBinding.otherMemberLabels.join('+')}
                              </span>
                            )}
                          </div>
                        ) : walkInCell ? (
                          <div className="bg-amber-100 border border-amber-300 text-amber-900 text-xs p-1.5 rounded inline-flex items-center justify-center gap-1">
                            {walkInCell.isStart ? (
                              <span className="font-medium truncate">
                                {walkInCell.walkIn.walkInName
                                  ? t('calendar.walkInNamed', { name: walkInCell.walkIn.walkInName, count: walkInCell.walkIn.partySize })
                                  : t('calendar.walkInAnon', { count: walkInCell.walkIn.partySize })}
                              </span>
                            ) : (
                              <span className="opacity-40" aria-hidden="true">·</span>
                            )}
                          </div>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {tables.length === 0 && (
        <div className="mt-6 text-center py-12 bg-white rounded-lg shadow text-gray-500">
          No tables in this section
        </div>
      )}

      {/* C6 P3-8 mounts: occupied-cell click and empty-cell click. */}
      <ReservationDetailPopup
        reservation={popupReservation}
        isOpen={popupOpen}
        onClose={() => { setPopupOpen(false); setPopupReservation(null) }}
        onAction={() => {
          setPopupOpen(false)
          setPopupReservation(null)
          loadData(true)
        }}
      />
      <QuickAddReservation
        isOpen={quickAddOpen}
        onClose={() => { setQuickAddOpen(false); setQuickAddPrefill(null) }}
        prefill={quickAddPrefill}
        onSaveSuccess={() => loadData(true)}
      />
    </div>
  )
}
