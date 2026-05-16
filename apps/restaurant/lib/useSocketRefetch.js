'use client'

// Wire reconnect + tab-focus refetch per memory/waiter_ux_strategy.md §4.4.
// Pass in a stable refetch function (wrap with useCallback in the caller).

import { useEffect } from 'react'
import { getSocket } from './socket'

export function useSocketRefetch(refetch) {
  useEffect(() => {
    if (typeof window === 'undefined' || !refetch) return
    const s = getSocket()
    if (!s) return

    const onConnect = () => { refetch() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    s.on('connect', onConnect)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      s.off('connect', onConnect)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refetch])
}
