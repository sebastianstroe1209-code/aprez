'use client'

import { useState, useEffect } from 'react'
import { apiGet } from '../../lib/api'

export default function DashboardPage() {
  const [stats, setStats] = useState({
    todayReservations: 0,
    pendingConfirmations: 0,
    currentOccupancy: 0,
    waitlistSize: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      setLoading(true)
      const today = new Date().toISOString().split('T')[0]

      const [resData, pendingData, waitlistData] = await Promise.all([
        apiGet(`/api/restaurant/reservations?date=${today}`),
        apiGet('/api/restaurant/reservations/pending'),
        apiGet('/api/restaurant/waitlist'),
      ])

      setStats({
        todayReservations: resData.length,
        pendingConfirmations: pendingData.length,
        currentOccupancy: resData.filter(r => r.status === 'CONFIRMED' || r.status === 'AUTO_CONFIRMED').length,
        waitlistSize: waitlistData.length,
      })
    } catch (err) {
      setError(err.message || 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading dashboard...</div>
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium mb-2">Today's Reservations</div>
          <div className="text-4xl font-bold text-primary">{stats.todayReservations}</div>
          <p className="text-gray-600 text-xs mt-2">confirmed and pending</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium mb-2">Pending Confirmations</div>
          <div className="text-4xl font-bold text-orange-500">{stats.pendingConfirmations}</div>
          <p className="text-gray-600 text-xs mt-2">awaiting confirmation</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium mb-2">Current Occupancy</div>
          <div className="text-4xl font-bold text-blue-500">{stats.currentOccupancy}</div>
          <p className="text-gray-600 text-xs mt-2">tables occupied</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium mb-2">Waitlist</div>
          <div className="text-4xl font-bold text-purple-500">{stats.waitlistSize}</div>
          <p className="text-gray-600 text-xs mt-2">guests waiting</p>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/dashboard/live"
            className="block p-4 border-2 border-primary border-dashed rounded-lg hover:bg-primary-bg transition-colors"
          >
            <div className="font-bold text-primary">View Live Floor Plan</div>
            <p className="text-sm text-gray-600 mt-1">See real-time table statuses and manage seating</p>
          </a>
          <a
            href="/dashboard/reservations"
            className="block p-4 border-2 border-primary border-dashed rounded-lg hover:bg-primary-bg transition-colors"
          >
            <div className="font-bold text-primary">Manage Reservations</div>
            <p className="text-sm text-gray-600 mt-1">View and confirm pending reservations</p>
          </a>
          <a
            href="/dashboard/waitlist"
            className="block p-4 border-2 border-primary border-dashed rounded-lg hover:bg-primary-bg transition-colors"
          >
            <div className="font-bold text-primary">Check Waitlist</div>
            <p className="text-sm text-gray-600 mt-1">Manage guests waiting for tables</p>
          </a>
          <a
            href="/dashboard/calendar"
            className="block p-4 border-2 border-primary border-dashed rounded-lg hover:bg-primary-bg transition-colors"
          >
            <div className="font-bold text-primary">View Calendar</div>
            <p className="text-sm text-gray-600 mt-1">See all reservations in calendar view</p>
          </a>
        </div>
      </div>
    </div>
  )
}
