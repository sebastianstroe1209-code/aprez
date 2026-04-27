'use client'

import { useEffect, useState } from 'react'
import { apiGet } from '../../lib/api'

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAnalytics()
  }, [])

  const fetchAnalytics = async () => {
    try {
      setLoading(true)
      const result = await apiGet('/api/admin/analytics/overview')
      setData(result)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
        Error: {error}
      </div>
    )
  }

  const cards = [
    {
      title: 'Total Restaurants',
      value: data?.totalRestaurants || 0,
      color: 'bg-blue-500',
      href: '/dashboard/restaurants',
    },
    {
      title: 'Reservations This Month',
      value: data?.totalReservationsThisMonth || 0,
      color: 'bg-green-500',
      href: '/dashboard',
    },
    {
      title: 'Total Diners This Month',
      value: data?.totalDinersThisMonth || 0,
      color: 'bg-purple-500',
      href: '/dashboard',
    },
    {
      title: 'Revenue (RON)',
      value: `${(data?.totalDinersThisMonth || 0) * 1} RON`,
      color: 'bg-yellow-500',
      href: '/dashboard/billing',
    },
    {
      title: 'Growth',
      value: `${data?.growthPercentage || 0}%`,
      color: 'bg-indigo-500',
      href: '/dashboard',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Dashboard Overview</h1>
        <p className="text-gray-600">Welcome to ApRez Admin Panel</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {cards.map((card, idx) => (
          <div
            key={idx}
            onClick={() => window.location.href = card.href}
            className="cursor-pointer transform transition-transform hover:scale-105"
          >
            <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-gray-200 hover:shadow-lg transition-shadow">
              <p className="text-gray-600 text-sm font-medium mb-2">{card.title}</p>
              <p className="text-3xl font-bold text-gray-800">{card.value}</p>
              <div className={`${card.color} h-1 rounded mt-4`}></div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="/dashboard/restaurants/new"
            className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">🍽️</div>
            <p className="font-medium text-gray-800">Create Restaurant</p>
          </a>
          <a
            href="/dashboard/team"
            className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">👥</div>
            <p className="font-medium text-gray-800">Manage Team</p>
          </a>
          <a
            href="/dashboard/billing"
            className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">💰</div>
            <p className="font-medium text-gray-800">View Billing</p>
          </a>
        </div>
      </div>
    </div>
  )
}
