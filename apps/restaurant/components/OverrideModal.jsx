'use client'

// Tier I commit 2 — standalone confirm modal triggered when an assign-
// table or seat call returns 409 `party-too-large`. Per Tier I decision
// 7, the override flow lives OUTSIDE the popup so the popup density
// stays manageable. The 409 body's structured fields drive the localized
// copy verbatim — no client-side recomputation of the table label or
// seat count.

import { useState } from 'react'
import { useTranslations } from 'next-intl'

// Props:
//   info: the 409 body's error sub-object — {
//     tableId, tableLabel, seatCount, partySize, mergeGroupId | null
//   }
//   onCancel: () => void
//   onConfirm: () => Promise<void>   // caller re-POSTs with force: true
export default function OverrideModal({ info, onCancel, onConfirm }) {
  const t = useTranslations('override')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    if (submitting) return
    setError('')
    setSubmitting(true)
    try {
      await onConfirm()
    } catch (err) {
      setError(err?.message || 'Override failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!info) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-2xl shrink-0">⚠</div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{t('title')}</h3>
            <p className="mt-2 text-sm text-gray-700">
              {t('body', {
                partySize: info.partySize,
                tableLabel: info.tableLabel,
                seatCount: info.seatCount,
              })}
            </p>
          </div>
        </div>

        {error && (
          <div className="my-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 rounded border border-gray-300 text-gray-800 font-medium hover:bg-gray-50 disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-4 py-2 rounded bg-orange-600 text-white font-semibold hover:bg-orange-700 disabled:opacity-60"
          >
            {submitting ? t('assigning') : t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
