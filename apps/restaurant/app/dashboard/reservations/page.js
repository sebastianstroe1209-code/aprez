'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiGet, apiPut, apiPost } from '../../../lib/api'
import { formatDate } from '../../../lib/format'
import { subscribe } from '../../../lib/socket'
import { useSocketRefetch } from '../../../lib/useSocketRefetch'
import { useReservationsTab } from '../../../lib/pendingContext'
import SpecialRequestsBadge from '../../../components/ui/SpecialRequestsBadge'
import MinLateBadge from '../../../components/ui/MinLateBadge'
import ReservationDetailPopup from '../../../components/ReservationDetailPopup'

const statusBadgeColor = {
  PENDING: 'bg-status-pending-bg text-status-pending-fg',
  CONFIRMED: 'bg-status-confirmed-bg text-status-confirmed-fg',
  AUTO_CONFIRMED: 'bg-status-confirmed-bg text-status-confirmed-fg',
  CANCELLED: 'bg-status-cancelled-bg text-status-cancelled-fg',
  COMPLETED: 'bg-status-neutral-bg text-status-neutral-fg',
  NO_SHOW: 'bg-status-noshow-bg text-status-noshow-fg',
}

// Tier E commit 1 — build the short "Wants: …" summary that renders
// inline on Modifications-tab rows under the guest name. Includes only
// the changed fields, with old → new arrows. Dates are normalized to
// DD-MM-YYYY per SPEC §11.
function buildModSummary(reservation, mod) {
  if (!mod) return ''
  const parts = []
  if (mod.requestedDate) {
    const ddmmyyyy = (iso) => {
      const s = typeof iso === 'string' ? iso.slice(0, 10) : new Date(iso).toISOString().slice(0, 10)
      const [y, m, d] = s.split('-')
      return y && m && d ? `${d}-${m}-${y}` : s
    }
    parts.push(`${ddmmyyyy(reservation.date)} → ${ddmmyyyy(mod.requestedDate)}`)
  }
  if (mod.requestedTime) {
    parts.push(`${reservation.time || '—'} → ${mod.requestedTime}`)
  }
  if (mod.requestedPartySize != null) {
    parts.push(`×${reservation.partySize ?? '—'} → ×${mod.requestedPartySize}`)
  }
  return parts.join(' · ')
}

// Compute seconds-late client-side for the Reservations table (the
// /reservations endpoint doesn't return secondsLate; only /layout/live
// and /dashboard/summary do). Returns a number when the row's table is
// AWAITING_GUEST and the reservation hasn't been seated yet; otherwise
// null. Same threshold as the shared <MinLateBadge> (>600 → render).
function reservationSecondsLate(res) {
  if (res?.seatedAt) return null
  if (res?.table?.status !== 'AWAITING_GUEST') return null
  if (!res.time || !res.date) return null
  const resDate = typeof res.date === 'string' ? res.date.slice(0, 10) : new Date(res.date).toISOString().slice(0, 10)
  const todayBuch = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
  if (resDate !== todayBuch) return null
  const buchHm = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [rh, rm] = res.time.split(':').map(Number)
  const [nh, nm] = buchHm.split(':').map(Number)
  const mins = (nh * 60 + nm) - (rh * 60 + rm)
  return mins > 0 ? mins * 60 : null
}

export default function ReservationsPage() {
  const router = useRouter()
  const t = useTranslations()
  const searchParams = useSearchParams()
  const { setActiveTab } = useReservationsTab()
  // Seed initial tab from ?tab=… so the pending-alert toast's Review
  // button (and the header badge click) land on the right list.
  const initialTab = (() => {
    const fromUrl = searchParams.get('tab')
    if (fromUrl === 'all' || fromUrl === 'pending' || fromUrl === 'today' || fromUrl === 'modifications') return fromUrl
    return 'all'
  })()
  const [tab, setTab] = useState(initialTab)
  const focusId = searchParams.get('focus')
  const focusRowRef = useRef(null)
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  // Tier E commit 1 — global count of reservations with a PENDING
  // ReservationModification. Side-loaded so the Modifications tab badge
  // shows the right number from any tab. Refreshed on socket
  // reservation:updated events (which fire on diner POST /modify and
  // staff approve/reject).
  const [modificationCount, setModificationCount] = useState(0)
  // Tier E commit 1 — open the shared popup when a Modifications-tab
  // row is clicked. Mounted only for this surface; other tabs keep their
  // existing inline-action UX.
  const [popupRow, setPopupRow] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [createForm, setCreateForm] = useState({
    guestName: '',
    guestPhone: '',
    date: '',
    time: '',
    partySize: '',
    specialRequests: '',
  })

  useEffect(() => {
    loadReservations()
  }, [tab])

  // Tier E commit 1 — side-load the modification count from the same
  // /reservations endpoint (which now shapes the row with
  // modificationPending). Cheap: one fetch on mount, then re-fetch on
  // every reservation:updated socket event so the tab badge tracks the
  // queue in real time without the user needing to refresh.
  const refreshModificationCount = useCallback(async () => {
    try {
      const all = await apiGet('/api/restaurant/reservations')
      const n = (all || []).filter((r) => r.modificationPending && r.modificationPending.status === 'PENDING').length
      setModificationCount(n)
    } catch { /* count is non-critical — silent failure */ }
  }, [])
  useEffect(() => { refreshModificationCount() }, [refreshModificationCount])
  useEffect(() => {
    const unsub = subscribe('reservation:updated', () => { refreshModificationCount() })
    return () => unsub()
  }, [refreshModificationCount])

  // Publish the active tab so PendingReservationListener can suppress
  // the toast when the user is already on the Pending tab (§3.6).
  useEffect(() => {
    setActiveTab(tab)
    return () => setActiveTab(null)
  }, [tab, setActiveTab])

  // Scroll the focused row into view after data loads (toast→Review flow).
  useEffect(() => {
    if (!focusId || loading) return
    if (focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [focusId, loading, reservations])

  // C4 real-time wiring per §5a. Surgical list updates — no whole-list refetch
  // on each event. Tab/full refetch only on socket reconnect or tab focus
  // (§4.4) via useSocketRefetch below.
  useEffect(() => {
    const isRelevantToTab = (r) => {
      if (tab === 'pending') return r.status === 'PENDING'
      if (tab === 'today') {
        const todayBuch = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
        const resDate = typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10)
        return resDate === todayBuch
      }
      if (tab === 'modifications') {
        return !!(r.modificationPending && r.modificationPending.status === 'PENDING')
      }
      return true
    }
    const upsert = (r) => {
      if (!r?.id) return
      setReservations((list) => {
        const idx = list.findIndex((x) => x.id === r.id)
        if (idx === -1) {
          return isRelevantToTab(r) ? [r, ...list] : list
        }
        const merged = { ...list[idx], ...r }
        if (!isRelevantToTab(merged)) {
          return list.filter((_, i) => i !== idx)
        }
        const next = list.slice()
        next[idx] = merged
        return next
      })
    }
    const onCancelled = (payload) => {
      if (!payload?.id) return
      setReservations((list) =>
        list.map((r) => (r.id === payload.id ? { ...r, ...payload, status: 'CANCELLED' } : r))
      )
    }
    const unsubs = [
      subscribe('reservation:created', upsert),
      subscribe('reservation:updated', upsert),
      subscribe('reservation:cancelled', onCancelled),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [tab])

  const refetchOnReconnect = useCallback(() => { loadReservations(true) }, [tab])
  useSocketRefetch(refetchOnReconnect)

  // `quiet=true` skips the setLoading(true) toggle so background refetches
  // (socket reconnect / visibilitychange) don't trip the early-return at
  // the top of the render, which would unmount any open modal mid-click.
  // Initial-mount calls leave quiet=false so the "Loading…" placeholder
  // still shows on first paint.
  const loadReservations = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true)
      let data = []

      if (tab === 'pending') {
        data = await apiGet('/api/restaurant/reservations/pending')
      } else if (tab === 'today') {
        // SPEC §11: dates compared in Europe/Bucharest. en-CA returns YYYY-MM-DD.
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
        data = await apiGet(`/api/restaurant/reservations?date=${today}`)
      } else if (tab === 'modifications') {
        // Tier E commit 1 — re-uses the /reservations endpoint (now
        // shapes modificationPending into each row) and filters
        // client-side. The Modifications-tab volume is low enough that a
        // dedicated endpoint isn't worth the extra surface.
        const all = await apiGet('/api/restaurant/reservations')
        data = (all || []).filter((r) => r.modificationPending && r.modificationPending.status === 'PENDING')
      } else {
        data = await apiGet('/api/restaurant/reservations')
      }

      setReservations(data)
    } catch (err) {
      setError(err.message || 'Failed to load reservations')
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchQuery.trim()) {
      loadReservations()
      return
    }
    try {
      const data = await apiGet(`/api/restaurant/reservations/search?q=${encodeURIComponent(searchQuery)}`)
      setReservations(data)
    } catch (err) {
      alert('Search failed: ' + err.message)
    }
  }

  const handleConfirmClick = (reservation) => {
    router.push(`/dashboard/live?confirmReservationId=${reservation.id}`)
  }

  const handleReject = async (id) => {
    if (!confirm('Are you sure you want to reject this reservation?')) return
    try {
      await apiPut(`/api/restaurant/reservations/${id}/reject`, {})
      loadReservations()
    } catch (err) {
      alert('Failed to reject: ' + err.message)
    }
  }

  const handleSeat = async (id) => {
    const actualPartySize = prompt('Enter actual party size:')
    if (!actualPartySize) return
    try {
      await apiPut(`/api/restaurant/reservations/${id}/seat`, {
        actualPartySize: parseInt(actualPartySize),
      })
      loadReservations()
    } catch (err) {
      alert('Failed to seat: ' + err.message)
    }
  }

  const handleComplete = async (id) => {
    try {
      await apiPut(`/api/restaurant/reservations/${id}/complete`, {})
      loadReservations()
    } catch (err) {
      alert('Failed to complete: ' + err.message)
    }
  }

  const handleNoShow = async (id) => {
    if (!confirm('Mark as no-show?')) return
    try {
      await apiPut(`/api/restaurant/reservations/${id}/no-show`, {})
      loadReservations()
    } catch (err) {
      alert('Failed to mark no-show: ' + err.message)
    }
  }

  const handleCancel = async (id) => {
    if (!confirm('Cancel this reservation?')) return
    try {
      await apiPut(`/api/restaurant/reservations/${id}/cancel`, {})
      loadReservations()
    } catch (err) {
      alert('Failed to cancel: ' + err.message)
    }
  }

  const handleCreateSubmit = async (e) => {
    e.preventDefault()
    try {
      const created = await apiPost('/api/restaurant/reservations', {
        guestName: createForm.guestName,
        guestPhone: createForm.guestPhone,
        date: createForm.date,
        time: createForm.time,
        partySize: parseInt(createForm.partySize),
        specialRequests: createForm.specialRequests.trim() || undefined,
      })
      setShowCreateModal(false)
      setCreateForm({
        guestName: '',
        guestPhone: '',
        date: '',
        time: '',
        partySize: '',
        specialRequests: '',
      })
      // Spec §9.5: staff-created reservations auto-confirm. Send staff straight
      // to the floor plan to assign a table.
      router.push(`/dashboard/live?confirmReservationId=${created.id}`)
    } catch (err) {
      alert('Failed to create reservation: ' + err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading reservations...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{t('reservations.title')}</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark transition-colors"
        >
          {t('reservations.createButton')}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-alert-error-bg border border-alert-error-border text-alert-error-fg rounded">
          {error}
        </div>
      )}

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-6 bg-white rounded-lg shadow p-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search by name, phone, email, time, or party size..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <button type="submit" className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark">
            Search
          </button>
        </div>
      </form>

      {/* Tabs */}
      <div className="mb-6 bg-white rounded-lg shadow">
        <div className="flex border-b">
          {[
            { id: 'all', labelKey: 'reservations.tabAll' },
            { id: 'pending', labelKey: 'reservations.tabPending' },
            { id: 'today', labelKey: 'reservations.tabToday' },
            // Tier E commit 1 — Modifications queue. ICU plural-ready
            // key takes a {count} placeholder.
            { id: 'modifications', labelKey: 'reservations.tabModifications', params: { count: modificationCount } },
          ].map((tabDef) => (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className={`px-6 py-3 font-medium transition-colors ${
                tab === tabDef.id
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tabDef.params ? t(tabDef.labelKey, tabDef.params) : t(tabDef.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Reservations Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {reservations.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No reservations found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Guest</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Phone</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Date</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Time</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Party</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Table</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((res) => {
                  // Tier E commit 1 — Modifications tab makes rows
                  // clickable; the popup renders the amber callout +
                  // approve/reject inline.
                  const isModRow = tab === 'modifications' && !!(res.modificationPending && res.modificationPending.status === 'PENDING')
                  // Build the inline "Wants: …" summary from the
                  // requested-fields in the modification row.
                  const modSummary = isModRow ? buildModSummary(res, res.modificationPending) : null
                  return (
                  <tr
                    key={res.id}
                    ref={res.id === focusId ? focusRowRef : null}
                    onClick={isModRow ? () => setPopupRow(res) : undefined}
                    className={`border-b hover:bg-gray-50 ${res.id === focusId ? 'bg-amber-50' : ''} ${isModRow ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-1">
                        <span>{res.guestName || (res.user ? `${res.user.firstName} ${res.user.lastName}` : 'N/A')}</span>
                        <SpecialRequestsBadge specialRequests={res.specialRequests} />
                      </div>
                      {res.specialRequests && (
                        <div className="text-xs text-gray-500 italic mt-1">Note: {res.specialRequests}</div>
                      )}
                      {isModRow && (
                        <div className="text-xs text-amber-800 italic mt-1">
                          {t('reservations.modificationDiffInline', { summary: modSummary })}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">{res.guestPhone || res.user?.phone || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">{formatDate(res.date)}</td>
                    <td className="px-6 py-4 text-sm">{res.time}</td>
                    <td className="px-6 py-4 text-sm">{res.partySize}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-3 py-1 rounded text-xs font-medium ${statusBadgeColor[res.status] || 'bg-status-neutral-bg text-status-neutral-fg'}`}>
                          {res.status.replace(/_/g, ' ')}
                        </span>
                        {res.seatedAt && (res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED') && (
                          <span className="px-3 py-1 rounded text-xs font-medium bg-status-info-bg text-status-info-fg">
                            Seated
                          </span>
                        )}
                        <MinLateBadge secondsLate={res.secondsLate ?? reservationSecondsLate(res)} />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {res.table?.tableNumber ? (
                        <span className="flex items-center gap-1 flex-wrap">
                          <span>{res.table.tableNumber}</span>
                          {/* Tier I commit 3 — inline merge tag when the
                              row's tableId belongs to an active merge
                              whose window covers the reservation's time.
                              Uses the combined label so the row reads
                              the same as the popup header chip. */}
                          {res.mergeBinding && (
                            <span
                              className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-semibold border border-amber-300"
                              title={res.mergeBinding.combinedLabel}
                            >
                              merged: {res.mergeBinding.combinedLabel}
                            </span>
                          )}
                        </span>
                      ) : (res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED')
                        ? <span className="text-orange-600 italic">{t('reservations.unassignedTable')}</span>
                        : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {res.status === 'PENDING' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleConfirmClick(res)}
                            className="text-xs px-2 py-1 bg-primary text-white rounded hover:bg-primary-dark"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => handleReject(res.id)}
                            className="text-xs px-2 py-1 bg-action-danger text-white rounded hover:bg-action-danger-hover"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {(res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED') && !res.seatedAt && (
                        <div className="flex gap-2 flex-wrap">
                          {!res.tableId && (
                            <button
                              onClick={() => handleConfirmClick(res)}
                              className="text-xs px-2 py-1 bg-primary text-white rounded hover:bg-primary-dark"
                            >
                              Pick table
                            </button>
                          )}
                          {res.tableId && (
                            <button
                              onClick={() => handleSeat(res.id)}
                              className="text-xs px-2 py-1 bg-action-info text-white rounded hover:bg-action-info-hover"
                            >
                              Seat
                            </button>
                          )}
                          <button
                            onClick={() => handleCancel(res.id)}
                            className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {(res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED') && res.seatedAt && (
                        <button
                          onClick={() => handleComplete(res.id)}
                          className="text-xs px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600"
                        >
                          Complete
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tier E commit 1 — popup for the Modifications tab. The popup
          handles approve/reject internally + toasts on success. */}
      {popupRow && (
        <ReservationDetailPopup
          reservation={popupRow}
          isOpen={!!popupRow}
          onClose={() => { setPopupRow(null); loadReservations(true); refreshModificationCount() }}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Create Manual Reservation</h2>
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Guest Name</label>
                  <input
                    type="text"
                    value={createForm.guestName}
                    onChange={(e) => setCreateForm({ ...createForm, guestName: e.target.value })}
                    required
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Guest Phone</label>
                  <input
                    type="text"
                    value={createForm.guestPhone}
                    onChange={(e) => setCreateForm({ ...createForm, guestPhone: e.target.value })}
                    required
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Date</label>
                  <input
                    type="date"
                    lang="en-GB"
                    value={createForm.date}
                    onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })}
                    required
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Time</label>
                  <input
                    type="time"
                    lang="en-GB"
                    value={createForm.time}
                    onChange={(e) => setCreateForm({ ...createForm, time: e.target.value })}
                    required
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Party Size</label>
                  <input
                    type="number"
                    min="1"
                    value={createForm.partySize}
                    onChange={(e) => setCreateForm({ ...createForm, partySize: e.target.value })}
                    required
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Special Requests (optional)</label>
                  <textarea
                    value={createForm.specialRequests}
                    onChange={(e) => setCreateForm({ ...createForm, specialRequests: e.target.value })}
                    placeholder="anniversary, window seat, allergic to peanuts..."
                    rows={3}
                    className="w-full"
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
