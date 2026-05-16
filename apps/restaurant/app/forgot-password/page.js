'use client'

// Tier D commit 1 — restaurant-staff forgot-password entry per SPEC §6.8.
// Posts to /api/auth/restaurant/forgot-password (neutral 200 — never leaks
// whether the username exists). Shows a generic success message regardless.

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

export default function ForgotPasswordPage() {
  const t = useTranslations()
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      const response = await fetch('http://localhost:4000/api/auth/restaurant/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail: usernameOrEmail.trim() }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error?.message || 'Request failed')
      }
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2">{t('forgot.title')}</h1>
        <p className="text-sm text-gray-600 text-center mb-6">{t('forgot.subtitle')}</p>

        {submitted ? (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-900">
            {t('forgot.success')}
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('forgot.field')}
                </label>
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  required
                  autoFocus
                  disabled={loading}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !usernameOrEmail.trim()}
                className="w-full bg-primary text-white font-medium py-3 rounded hover:bg-primary-dark disabled:opacity-60 transition-colors min-h-[48px]"
              >
                {loading ? t('forgot.submitting') : t('forgot.submit')}
              </button>
            </form>
          </>
        )}

        <div className="mt-6 text-center">
          <Link href="/login" className="text-sm text-primary hover:underline">
            {t('forgot.backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
