'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, apiPut, apiPost } from '../../../lib/api'
import { formatDate } from '../../../lib/format'

const statusBadgeColor = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  AUTO_CONFIRMED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  COMPLETED: 'bg-gray-100 text-gray-800',
  NO_SHOW: 'bg-orange-100 text-orange-800',
}

export default function ReservationsPage() {
  const router = useRouter()
  const [tab, setTab] = useState('all') // 'all', 'pending', 'today'
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

  const loadReservations = async () => {
    try {
      setLoading(true)
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
      setLoading(false)
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
        <h1 className="text-3xl font-bold">Reservations</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark transition-colors"
        >
          Create Manual Reservation
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
            { id: 'all', label: 'All' },
            { id: 'pending', label: 'Pending' },
            { id: 'today', label: 'Today' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-6 py-3 font-medium transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
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
                  <tr key={res.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm">
                      <div>{res.guestName || (res.user ? `${res.user.firstName} ${res.user.lastName}` : 'N/A')}</div>
                      {res.specialRequests && (
                        <div className="text-xs text-gray-500 italic mt-1">Note: {res.specialRequests}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">{res.guestPhone || res.user?.phone || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">{formatDate(res.date)}</td>
                    <td className="px-6 py-4 text-sm">{res.time}</td>
                    <td className="px-6 py-4 text-sm">{res.partySize}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded text-xs font-medium ${statusBadgeColor[res.status] || 'bg-gray-100'}`}>
                        {res.status.replace(/_/g, ' ')}
                      </span>
                      {res.seatedAt && (res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED') && (
                        <span className="ml-2 px-3 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Seated
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {res.table?.tableNumber
                        ? res.table.tableNumber
                        : (res.status === 'CONFIRMED' || res.status === 'AUTO_CONFIRMED')
                          ? <span className="text-orange-600 italic">[unassigned]</span>
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
