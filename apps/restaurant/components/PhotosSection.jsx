'use client'

// Tier G commit 3 — staff-side Photos section for the restaurant Settings
// page (SPEC §6.7). Ported from the admin twin (apps/admin/components/
// PhotosSection.jsx); behaves identically. The only differences: the API
// paths target the JWT-scoped staff endpoints (/api/restaurant/photos)
// so there is no restaurantId prop, and identity is implicit from the JWT.
// Owns its own photos list state so it re-renders surgically.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiUpload, apiDelete, apiPut, uploadUrl } from '../lib/api'

const MAX_PHOTOS = 10
const ACCEPT = 'image/jpeg,image/png'

export default function PhotosSection({ initialPhotos = [], onChange }) {
  const t = useTranslations('photoUpload')
  const [photos, setPhotos] = useState(initialPhotos)
  const [uploading, setUploading] = useState(false)
  const [working, setWorking] = useState(null) // photoId currently being mutated
  const [error, setError] = useState('')

  const cover = photos.find((p) => p.isCover) || null

  const refresh = (next) => {
    setPhotos(next)
    onChange?.(next)
  }

  const handleFiles = async (e) => {
    const fileList = Array.from(e.target.files || [])
    if (!fileList.length) return
    setError('')

    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) {
      setError(t('errorLimit'))
      e.target.value = ''
      return
    }
    const toUpload = fileList.slice(0, remaining)

    setUploading(true)
    const next = [...photos]
    for (const file of toUpload) {
      if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
        setError(t('errorWrongType'))
        continue
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(t('errorTooLarge'))
        continue
      }
      try {
        const created = await apiUpload('/api/restaurant/photos', 'photo', file)
        next.push(created)
      } catch (err) {
        const msg = err.message || ''
        if (/photo-limit-reached/.test(msg) || /Maximum/i.test(msg)) setError(t('errorLimit'))
        else if (/file-too-large/.test(msg) || /size limit/i.test(msg)) setError(t('errorTooLarge'))
        else if (/invalid-file-type/.test(msg) || /JPG and PNG/i.test(msg)) setError(t('errorWrongType'))
        else setError(t('errorGeneric'))
        break
      }
    }
    refresh(next)
    setUploading(false)
    e.target.value = ''
  }

  const handleSetCover = async (photoId) => {
    setError('')
    setWorking(photoId)
    try {
      await apiPut(`/api/restaurant/photos/${photoId}/cover`, {})
      refresh(photos.map((p) => ({ ...p, isCover: p.id === photoId })))
    } catch (err) {
      setError(err.message || t('errorGeneric'))
    } finally {
      setWorking(null)
    }
  }

  const handleDelete = async (photoId) => {
    if (!confirm(t('deleteConfirm'))) return
    setError('')
    setWorking(photoId)
    try {
      await apiDelete(`/api/restaurant/photos/${photoId}`)
      refresh(photos.filter((p) => p.id !== photoId))
    } catch (err) {
      setError(err.message || t('errorGeneric'))
    } finally {
      setWorking(null)
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

      {/* Cover */}
      <div className="mb-6">
        <div className="text-sm font-medium text-gray-700 mb-2">{t('coverLabel')}</div>
        <div className="w-full max-w-md aspect-video bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex items-center justify-center">
          {cover ? (
            <img src={uploadUrl(cover.photoUrl)} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs text-gray-500 px-4 text-center">{t('coverEmpty')}</span>
          )}
        </div>
      </div>

      {/* Gallery */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-700">
          {t('galleryLabel', { count: photos.length, max: MAX_PHOTOS })}
        </div>
        <label
          className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
            uploading || photos.length >= MAX_PHOTOS
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-primary text-white hover:bg-primary-dark'
          }`}
        >
          {uploading ? t('uploading') : `+ ${t('addButton')}`}
          <input
            type="file"
            accept={ACCEPT}
            multiple
            onChange={handleFiles}
            disabled={uploading || photos.length >= MAX_PHOTOS}
            className="hidden"
          />
        </label>
      </div>

      {photos.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
          —
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((p) => (
            <div key={p.id} className="relative group rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
              <div className="aspect-square">
                <img src={uploadUrl(p.photoUrl)} alt="" className="w-full h-full object-cover" />
              </div>
              {p.isCover && (
                <div className="absolute top-2 left-2 bg-primary text-white text-xs font-semibold px-2 py-1 rounded">
                  ★ {t('isCover')}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {!p.isCover && (
                  <button
                    type="button"
                    onClick={() => handleSetCover(p.id)}
                    disabled={working === p.id}
                    className="w-full text-xs bg-white/95 text-gray-800 font-medium py-1.5 rounded hover:bg-white disabled:opacity-50"
                  >
                    ★ {t('setCover')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(p.id)}
                  disabled={working === p.id}
                  className="w-full text-xs bg-action-danger text-white font-medium py-1.5 rounded hover:bg-action-danger-hover disabled:opacity-50"
                >
                  ✕ {t('deleteButton')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
