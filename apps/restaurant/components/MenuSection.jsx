'use client'

// Tier G commit 3 — staff-side Menu PDF section for the restaurant
// Settings page (SPEC §6.7). Ported from the admin twin (apps/admin/
// components/MenuSection.jsx); behaves identically. The only difference:
// the API paths target the JWT-scoped staff endpoint (/api/restaurant/menu)
// so there is no restaurantId prop. One menu per restaurant; replacing
// overwrites the previous PDF in place.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiUpload, apiDelete, uploadUrl } from '../lib/api'

export default function MenuSection({ initialMenuUrl, onChange }) {
  const t = useTranslations('menuUpload')
  const [menuUrl, setMenuUrl] = useState(initialMenuUrl || null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')

    if (file.type !== 'application/pdf') {
      setError(t('errorWrongType'))
      e.target.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t('errorTooLarge'))
      e.target.value = ''
      return
    }

    setUploading(true)
    try {
      const data = await apiUpload('/api/restaurant/menu', 'menu', file)
      // Cache-bust the displayed URL — the stored path is stable so the
      // diner client still picks up the new file on next fetch.
      const fresh = data.menuPdfUrl ? `${data.menuPdfUrl}?v=${Date.now()}` : null
      setMenuUrl(fresh)
      onChange?.(data.menuPdfUrl)
    } catch (err) {
      const msg = err.message || ''
      if (/file-too-large/.test(msg) || /size limit/i.test(msg)) setError(t('errorTooLarge'))
      else if (/invalid-file-type/.test(msg) || /PDF files/i.test(msg)) setError(t('errorWrongType'))
      else setError(t('errorGeneric'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleRemove = async () => {
    if (!confirm(t('removeConfirm'))) return
    setError('')
    try {
      await apiDelete('/api/restaurant/menu')
      setMenuUrl(null)
      onChange?.(null)
    } catch (err) {
      setError(err.message || t('errorGeneric'))
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">{t('sectionTitle')}</h2>
      <p className="text-sm text-gray-500 mb-4">{t('sectionHint')}</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      <div className="border border-gray-200 rounded-lg p-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          {menuUrl ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-2xl">📄</span>
              <div className="flex flex-col">
                <span className="text-gray-700">{t('current')}</span>
                <a
                  href={uploadUrl(menuUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-medium"
                >
                  {t('view')}
                </a>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">{t('noMenu')}</div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label
            className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              uploading
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary-dark'
            }`}
          >
            {uploading ? t('uploading') : (menuUrl ? t('replaceButton') : t('uploadButton'))}
            <input
              type="file"
              accept="application/pdf"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
          {menuUrl && (
            <button
              type="button"
              onClick={handleRemove}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
            >
              {t('removeButton')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
