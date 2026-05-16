'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiGet } from '../../lib/api'
import { subscribe } from '../../lib/socket'
import { useAppLocale } from '../../lib/i18n/I18nProvider'

export default function DashboardPage() {
  const t = useTranslations()
  const { locale, setLocale } = useAppLocale()
  const [restaurantCount, setRestaurantCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Live counter of pending reservations seen via socket since this session
  // opened. Useful as a basic admin monitoring signal until the full admin
  // monitoring page exists (Tier J).
  const [livePendingSeen, setLivePendingSeen] = useState(0)

  useEffect(() => {
    apiGet('/api/admin/restaurants')
      .then((list) => {
        setRestaurantCount(Array.isArray(list) ? list.length : 0)
        setError('')
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const unsub = subscribe('reservation:pending-created', () => {
      setLivePendingSeen((n) => n + 1)
    })
    return () => unsub()
  }, [])

  if (loading) {
    return <div className="text-center py-12">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">{t('dashboard.title')}</h1>
          <p className="text-gray-600">{t('dashboard.subtitle')}</p>
        </div>
        {/* Language toggle (C5 scaffold) */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{t('dashboard.languageSectionTitle')}:</span>
          {['ro', 'en'].map((code) => (
            <button
              key={code}
              onClick={() => setLocale(code)}
              className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
                locale === code
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div
          onClick={() => (window.location.href = '/dashboard/restaurants')}
          className="cursor-pointer transform transition-transform hover:scale-105"
        >
          <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-gray-200 hover:shadow-lg transition-shadow">
            <p className="text-gray-600 text-sm font-medium mb-2">{t('dashboard.totalRestaurants')}</p>
            <p className="text-3xl font-bold text-gray-800">{restaurantCount ?? '—'}</p>
            <div className="bg-blue-500 h-1 rounded mt-4"></div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-amber-300">
          <p className="text-gray-600 text-sm font-medium mb-2">{t('dashboard.livePending')}</p>
          <p className="text-3xl font-bold text-gray-800">{livePendingSeen}</p>
          <div className="bg-amber-400 h-1 rounded mt-4"></div>
        </div>
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
        </div>
      </div>
    </div>
  )
}
