'use client'

// CalendarNowIndicator (C6 P3-8 §3.10 part a).
// Renders the "now" highlight on the calendar's current 15-min slot WITHOUT
// re-rendering the parent calendar every minute. The component owns its
// own setInterval; on each tick it finds the matching <tr data-time="HH:mm">
// in the container, adds the accent classes, and removes them from the
// previously-marked row. The component itself returns null — all visible
// change happens via DOM mutation, so the parent's React tree is stable.
//
// Renders nothing when `selectedDate !== today` (Europe/Bucharest).

import { useEffect } from 'react'

const ACCENT_CLASSES = ['bg-amber-50', 'border-l-4', 'border-l-amber-400']

function bucharestSlot() {
  const d = new Date()
  const hm = d.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [h, m] = hm.split(':').map(Number)
  const slotMin = Math.floor(m / 15) * 15
  return `${String(h).padStart(2, '0')}:${String(slotMin).padStart(2, '0')}`
}

function bucharestToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
}

export default function CalendarNowIndicator({ containerRef, selectedDate, label }) {
  useEffect(() => {
    if (!containerRef?.current) return
    if (selectedDate !== bucharestToday()) {
      // Defensive: scrub any stale accent the user navigates away from
      // today after the highlight was applied.
      const stale = containerRef.current.querySelector('tr[data-aprez-now="1"]')
      if (stale) {
        stale.classList.remove(...ACCENT_CLASSES)
        stale.removeAttribute('data-aprez-now')
        stale.removeAttribute('aria-label')
      }
      return
    }

    let prevRow = null

    const tick = () => {
      const slot = bucharestSlot()
      const container = containerRef.current
      if (!container) return
      const row = container.querySelector(`tr[data-time="${slot}"]`)
      if (row === prevRow) return
      if (prevRow) {
        prevRow.classList.remove(...ACCENT_CLASSES)
        prevRow.removeAttribute('data-aprez-now')
        prevRow.removeAttribute('aria-label')
      }
      if (row) {
        row.classList.add(...ACCENT_CLASSES)
        row.setAttribute('data-aprez-now', '1')
        if (label) row.setAttribute('aria-label', label)
      }
      prevRow = row
    }

    // Run once immediately so the indicator is visible without waiting 60s,
    // then tick every 60 seconds. The 15-min slot only changes 4×/hour but
    // the cost of an extra check is one querySelector — cheap.
    tick()
    const handle = setInterval(tick, 60000)
    return () => {
      clearInterval(handle)
      if (prevRow) {
        prevRow.classList.remove(...ACCENT_CLASSES)
        prevRow.removeAttribute('data-aprez-now')
        prevRow.removeAttribute('aria-label')
      }
    }
  }, [containerRef, selectedDate, label])

  return null
}
