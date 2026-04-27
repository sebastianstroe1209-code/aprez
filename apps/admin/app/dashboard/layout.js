'use client'

import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, useEffect } from 'react'

const navigationItems = [
  { name: 'Dashboard', href: '/dashboard', icon: '📊' },
  { name: 'Restaurants', href: '/dashboard/restaurants', icon: '🍽️' },
  { name: 'Billing', href: '/dashboard/billing', icon: '💰' },
  { name: 'Team', href: '/dashboard/team', icon: '👥' },
]

export default function DashboardLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
    const token = localStorage.getItem('adminToken')
    if (!token) {
      router.push('/login')
    }
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    router.push('/login')
  }

  if (!isMounted) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-white p-6 fixed left-0 top-0 bottom-0 overflow-y-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">ApRez Admin</h1>
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
                    ? 'bg-accent text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="mr-2">{item.icon}</span>
                {item.name}
              </Link>
            )
          })}
        </nav>

        <div className="mt-8 pt-8 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors text-sm font-medium"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 ml-64">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 px-8 py-6 sticky top-0 shadow-sm z-10">
          <h2 className="text-2xl font-bold text-gray-800">ApRez Admin Portal</h2>
        </header>

        {/* Page Content */}
        <main className="p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
