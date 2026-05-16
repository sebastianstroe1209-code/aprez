'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSocket, subscribeStatus } from '../lib/socket'

export default function ReconnectingBanner() {
  const t = useTranslations()
  const [show, setShow] = useState(false)

  useEffect(() => {
    getSocket()
    let timer = null
    const unsub = subscribeStatus((connected) => {
      if (connected) {
        if (timer) { clearTimeout(timer); timer = null }
        setShow(false)
      } else {
        if (!timer) timer = setTimeout(() => setShow(true), 2000)
      }
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [])

  if (!show) return null
  return (
    <div className="fixed top-0 left-64 right-0 z-50 bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 text-sm font-medium text-center">
      {t('common.reconnecting')}
    </div>
  )
}
