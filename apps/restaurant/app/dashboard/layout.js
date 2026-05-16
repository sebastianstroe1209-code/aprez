'use client'

import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { apiGet } from '../../lib/api'
import { getSocket, resetSocket } from '../../lib/socket'
import ReconnectingBanner from '../../components/ReconnectingBanner'

const navigationItems = [
  { key: 'dashboard', href: '/dashboard', icon: '📊' },
  { key: 'live', href: '/dashboard/live', icon: '📍' },
  { key: 'reservations', href: '/dashboard/reservations', icon: '📅' },
  { key: 'calendar', href: '/dashboard/calendar', icon: '📆' },
  { key: 'settings', href: '/dashboard/settings', icon: '⚙️' },
]

export default function DashboardLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations()
  const [isMounted, setIsMounted] = useState(false)
  const [restaurantName, setRestaurantName] = useState('Restaurant')

  useEffect(() => {
    setIsMounted(true)
    const token = localStorage.getItem('restaurantToken')
    if (!token) {
      router.push('/login')
    } else {
      // Initialize the shared Socket.IO connection (C4). Auto-joins the
      // restaurant's room via the JWT handshake on the server.
      getSocket()
      // Fetch restaurant profile
      apiGet('/api/restaurant/profile')
        .then(data => setRestaurantName(data.nameEn || data.nameRo || 'Restaurant'))
        .catch(err => console.error('Failed to load restaurant profile:', err))
    }
  }, [router])

  const handleLogout = () => {
    resetSocket()
    localStorage.removeItem('restaurantToken')
    router.push('/login')
  }

  if (!isMounted) {
    return <div className="flex items-center justify-center min-h-screen">{t('common.loading')}</div>
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-white p-6 fixed left-0 top-0 bottom-0 overflow-y-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t('common.appName')}</h1>
          <p className="text-sm text-gray-400 mt-2">{restaurantName}</p>
        </div>

        <nav className="space-y-2">
          {navigationItems.map((item) => {
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="mr-2">{item.icon}</span>
                {t(`nav.${item.key}`)}
              </Link>
            )
          })}
        </nav>

        <div className="mt-8 pt-8 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors text-sm font-medium"
          >
            {t('common.logout')}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 ml-64">
        <ReconnectingBanner />
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 px-8 py-6 sticky top-0 shadow-sm z-10">
          <h2 className="text-2xl font-bold text-gray-800">{t('common.platformTitle')}</h2>
        </header>

        {/* Page Content */}
        <main className="p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
