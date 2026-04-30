'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiGet, apiPut } from '../../../lib/api'

const statusColors = {
  FREE: { bg: 'bg-green-50', border: 'border-table-free', text: 'text-green-900', label: 'Free' },
  OCCUPIED: { bg: 'bg-red-50', border: 'border-table-occupied', text: 'text-red-900', label: 'Occupied' },
  ARRIVING_SOON: { bg: 'bg-orange-50', border: 'border-table-arriving', text: 'text-orange-900', label: 'Arriving Soon' },
  AWAITING_GUEST: { bg: 'bg-pink-50', border: 'border-table-awaiting', text: 'text-pink-900', label: 'Awaiting Guest' },
  OUT_OF_SERVICE: { bg: 'bg-gray-50', border: 'border-table-out', text: 'text-gray-900', label: 'Out of Service' },
}

export default function LiveFloorPlanPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const confirmReservationId = searchParams.get('confirmReservationId')

  const [sections, setSections] = useState([])
  const [activeSection, setActiveSection] = useState(null)
  const [selectedTable, setSelectedTable] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [newStatus, setNewStatus] = useState('')
  const [guestCount, setGuestCount] = useState(1)
  const [modalAction, setModalAction] = useState('status') // 'status' or 'seat'
  const [lastRefresh, setLastRefresh] = useState(null)

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

  const loadLayout = async () => {
    try {
      const data = await apiGet('/api/restaurant/layout')
      setSections(data)
      setLastRefresh(new Date())
      setActiveSection((prev) => {
        if (prev && data.find((s) => s.id === prev)) return prev
        return data.length > 0 ? data[0].id : null
      })
    } catch (err) {
      setError(err.message || 'Failed to load floor plan')
    } finally {
      setLoading(false)
    }
  }

  const handleTableClick = (table) => {
    setSelectedTable(table)
    setShowModal(true)
    setNewStatus(table.status)
    setGuestCount(1)
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
                      className={`border-2 rounded-lg p-3 transition-all ${
                        dimmed ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:shadow-lg'
                      } ${
                        isEligible ? 'ring-4 ring-primary ring-offset-2' : ''
                      } ${colors.bg} ${colors.border} ${colors.text}`}
                      style={{ minHeight: '90px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <div className="text-lg font-bold">{table.tableNumber}</div>
                      <div className="text-xs">{table.seatCount} seats</div>
                      <div className="text-xs mt-1">{colors.label}</div>
                    </button>
                  )
                }
                return (
                  <div
                    key={`${row}-${col}`}
                    className="border border-dashed border-gray-200 rounded-lg"
                    style={{ minHeight: '90px' }}
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
          <span>Last updated: {lastRefresh.toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  )
}
