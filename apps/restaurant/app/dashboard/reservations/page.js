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

const statusBadgeColor = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  AUTO_CONFIRMED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  COMPLETED: 'bg-gray-100 text-gray-800',
  NO_SHOW: 'bg-orange-100 text-orange-800',
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
    if (fromUrl === 'all' || fromUrl === 'pending' || fromUrl === 'today') return fromUrl
    return 'all'
  })()
  const [tab, setTab] = useState(initialTab)
  const focusId = searchParams.get('focus')
  const focusRowRef = useRef(null)
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
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
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
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
              {t(tabDef.labelKey)}
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
                {reservations.map((res) => (
                  <tr
                    key={res.id}
                    ref={res.id === focusId ? focusRowRef : null}
                    className={`border-b hover:bg-gray-50 ${res.id === focusId ? 'bg-amber-50' : ''}`}
                  >
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-1">
                        <span>{res.guestName || (res.user ? `${res.user.firstName} ${res.user.lastName}` : 'N/A')}</span>
                        <SpecialRequestsBadge specialRequests={res.specialRequests} />
                      </div>
                      {res.specialRequests && (
                        <div className="text-xs text-gray-500 italic mt-1">Note: {res.specialRequests}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">{res.guestPhone || res.user?.phone || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">{formatDate(res.date)}</td>
                    <td className="px-6 py-4 text-sm">{res.time}</td>
                    <td className="px-6 py-4 text-sm">{res.partySize}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-3 py-1 rounded text-xs font-medium ${statusBadgeColor[res.status] || 'bg-gray-100'}`}>
                          {res.status.replace(/_/g, ' ')}
                        </span>
                        {res.seatedAt && (res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED') && (
                          <span className="px-3 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            Seated
                          </span>
                        )}
                        <MinLateBadge secondsLate={res.secondsLate ?? reservationSecondsLate(res)} />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {res.table?.tableNumber
                        ? res.table.tableNumber
                        : (res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED')
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
                            className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
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
                              className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
