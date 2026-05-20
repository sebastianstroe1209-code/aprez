'use client'

// "Reconnecting…" banner — appears when the socket has been disconnected
// for >2s (no flicker on momentary blips), clears on reconnect.
// Spec: memory/waiter_ux_strategy.md §4.4.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSocket, subscribeStatus } from '../lib/socket'

export default function ReconnectingBanner() {
  const t = useTranslations()
  const [show, setShow] = useState(false)

  useEffect(() => {
    getSocket() // ensure singleton initialized
    let timer = null
    const unsub = subscribeStatus((connected) => {
      if (connected) {
        if (timer) { clearTimeout(timer); timer = null }
        setShow(false)
      } else {
        if (!timer) {
          timer = setTimeout(() => setShow(true), 2000)
        }
      }
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [])

  if (!show) return null
  // Responsive offset: full-width on phone (<768px, where the sidebar will
  // collapse into a hamburger in a later phase), offset-by-sidebar at
  // tablet/desktop. Keeps the banner centered over the content area at all
  // three §4.5 breakpoints (375 / 768 / 1440).
  return (
    <div className="fixed top-0 left-0 md:left-64 right-0 z-50 bg-alert-warning-bg border-b border-alert-warning-border text-alert-warning-fg px-4 py-2 text-sm font-medium text-center">
      {t('common.reconnecting')}
    </div>
  )
}
