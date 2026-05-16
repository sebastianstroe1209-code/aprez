'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '../../../lib/api'
import { subscribe } from '../../../lib/socket'
import { useSocketRefetch } from '../../../lib/useSocketRefetch'

// SPEC §11: dates handled in Europe/Bucharest. en-CA returns YYYY-MM-DD.
const todayBucharest = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })

export default function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState(todayBucharest())
  const [sections, setSections] = useState([])
  const [reservations, setReservations] = useState([])
  const [activeSection, setActiveSection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [selectedDate, activeSection])

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

  const refetchOnReconnect = useCallback(() => { loadData() }, [selectedDate, activeSection])
  useSocketRefetch(refetchOnReconnect)

  const loadData = async () => {
    try {
      setLoading(true)
      const [layoutData, resData] = await Promise.all([
        apiGet('/api/restaurant/layout'),
        apiGet(`/api/restaurant/reservations?date=${selectedDate}`),
      ])
      setSections(layoutData)
      if (layoutData.length > 0 && !activeSection) {
        setActiveSection(layoutData[0].id)
      }
      setReservations(resData)
    } catch (err) {
      setError(err.message || 'Failed to load calendar')
    } finally {
      setLoading(false)
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

  const getReservationForTableAndTime = (tableId, time) => {
    return reservations.find(r => {
      if (r.tableId !== tableId) return false
      const resStart = r.time?.substring(0, 5)
      if (!resStart) return false
      // Show reservation at its start time slot only (simplest approach)
      return resStart === time
    })
  }

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
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
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
                <tr key={time} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium border-r bg-gray-50">{time}</td>
                  {tables.map(table => {
                    const res = getReservationForTableAndTime(table.id, time)
                    return (
                      <td key={table.id} className="px-2 py-3 border-r text-center">
                        {res && (
                          <div className="bg-primary text-white text-xs p-2 rounded">
                            <div className="font-medium">
                              {res.guestName || (res.user ? `${res.user.firstName} ${res.user.lastName}` : 'Guest')}
                            </div>
                            <div className="text-xs">{res.partySize} guests</div>
                          </div>
                        )}
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
    </div>
  )
}
