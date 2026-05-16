'use client'

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
