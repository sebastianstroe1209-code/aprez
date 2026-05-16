'use client'

// Tier D commit 1 — restaurant-staff reset-password page per SPEC §6.8.
// Reads the token from `?token=`, lets the staff set a new password.
// Surfaces backend error codes (invalid-token / token-expired / token-used)
// as specific i18n copy so the staff knows whether to request a fresh link
// or use the one they already have.

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

export default function ResetPasswordPage() {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [missingToken, setMissingToken] = useState(false)

  useEffect(() => {
    if (!token) setMissingToken(true)
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    setError('')

    if (newPassword.length < 6) {
      setError(t('reset.errorMinLength'))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('reset.errorMismatch'))
      return
    }

    setLoading(true)
    try {
      const response = await fetch('http://localhost:4000/api/auth/restaurant/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const code = data?.error?.code
        const message =
          code === 'token-expired' ? t('reset.errorTokenExpired') :
          code === 'token-used'    ? t('reset.errorTokenUsed') :
          code === 'invalid-token' ? t('reset.errorInvalidToken') :
          (data?.error?.message || 'Request failed')
        throw new Error(message)
      }
      setSubmitted(true)
      // Brief celebratory moment, then bounce to /login for the new
      // password to actually be used. No auto-login — staff should
      // confirm the new password works by typing it.
      setTimeout(() => router.push('/login'), 2000)
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-2">{t('reset.title')}</h1>
        <p className="text-sm text-gray-600 text-center mb-6">{t('reset.subtitle')}</p>

        {missingToken ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            {t('reset.errorMissingToken')}
          </div>
        ) : submitted ? (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-900">
            {t('reset.success')}
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
                  {t('reset.newPassword')}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('reset.confirmPassword')}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base min-h-[48px]"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !newPassword || !confirmPassword}
                className="w-full bg-primary text-white font-medium py-3 rounded hover:bg-primary-dark disabled:opacity-60 transition-colors min-h-[48px]"
              >
                {loading ? t('reset.submitting') : t('reset.submit')}
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
