'use client'

// C6 P3-7 Dashboard rebuild — per memory/waiter_ux_strategy.md §3.8.
// The waiter's home page. Three zones (NOW / NEXT / SEARCH) plus stat
// tiles plus a header strip. Replaces the pre-P3-7 layout of three
// numeric tiles + three nav cards.
//
// Data source: GET /api/restaurant/dashboard/summary (C6 Phase 1).
// Real-time: subscribes to reservation:* / table:status-changed /
// walkin:* events and refetches summary on any of them (the payload is
// small + cacheable, surgical patching wasn't worth the complexity for
// this aggregate view). Initial mount + socket reconnect + page focus
// refetch via the existing useSocketRefetch hook (§4.4).

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiGet } from '../../lib/api'
import { subscribe } from '../../lib/socket'
import { useSocketRefetch } from '../../lib/useSocketRefetch'
import ReservationDetailPopup from '../../components/ReservationDetailPopup'
import NowZone from '../../components/dashboard/NowZone'
import NextZone from '../../components/dashboard/NextZone'
import SearchZone from '../../components/dashboard/SearchZone'
import StatTile from '../../components/dashboard/StatTile'

function bucharestNowHm() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function DashboardPage() {
  const t = useTranslations()
  const router = useRouter()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  // The "Now:" clock in the header strip. Update once per 30s — matches
  // the strategy doc's §5b freshness intervals.
  const [clock, setClock] = useState(bucharestNowHm())

  // Shared popup state — clicking any reservation row in any zone opens
  // the same ReservationDetailPopup (Phase 2).
  const [popupReservation, setPopupReservation] = useState(null)
  const [popupOpen, setPopupOpen] = useState(false)

  const load = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setLoading(true)
      const data = await apiGet('/api/restaurant/dashboard/summary')
      setSummary(data)
      setLastUpdated(new Date())
      setError('')
    } catch (err) {
      setError(err?.message || t('dashboard.loadError'))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [t])

  // Initial fetch.
  useEffect(() => { load() }, [load])

  // Header clock ticks every 30s. Independent of data fetches.
  useEffect(() => {
    const handle = setInterval(() => setClock(bucharestNowHm()), 30000)
    return () => clearInterval(handle)
  }, [])

  // Socket-driven refresh: any reservation/table/walkin event triggers a
  // quiet refetch of the summary. The dashboard is an aggregate view so
  // surgical state patching isn't worth the per-zone complexity.
  useEffect(() => {
    const refetch = () => load(true)
    const unsubs = [
      subscribe('reservation:created', refetch),
      subscribe('reservation:updated', refetch),
      subscribe('reservation:cancelled', refetch),
      subscribe('reservation:pending-created', refetch),
      subscribe('table:status-changed', refetch),
      subscribe('walkin:created', refetch),
      subscribe('walkin:ended', refetch),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [load])

  // §4.4 reconnect + tab-focus refetch (hook handles both triggers).
  const refetchOnReconnect = useCallback(() => load(true), [load])
  useSocketRefetch(refetchOnReconnect)

  const handlePick = (reservation) => {
    setPopupReservation(reservation)
    setPopupOpen(true)
  }

  if (loading && !summary) {
    return <div className="text-center py-12 text-sm text-gray-500">{t('common.loading')}</div>
  }

  const lastUpdatedClock = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-GB', {
        timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null

  return (
    <div className="space-y-6">
      {/* Header strip — page title left, time + last-updated right. */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <h1 className="text-3xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="tabular-nums">{t('dashboard.currentTime', { time: clock })}</span>
          {lastUpdatedClock && (
            <span className="tabular-nums">· {t('dashboard.lastUpdated', { time: lastUpdatedClock })}</span>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Stat tiles row — visible at <xl (1280px) where the right column
          would otherwise be cramped. At xl+ the same tiles render in
          the right column of the main grid below. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 xl:hidden">
        <StatTile
          label={t('dashboard.stats.today')}
          value={summary?.todayCount}
          accent="primary"
          href="/dashboard/reservations"
        />
        <StatTile
          label={t('dashboard.stats.pending')}
          value={summary?.pendingConfirmationCount}
          accent="amber"
          href="/dashboard/reservations?tab=pending"
        />
        <StatTile
          label={t('dashboard.stats.occupied')}
          value={summary?.occupiedCount}
          accent="blue"
          href="/dashboard/live"
        />
      </div>

      {/* Main grid:
          - <xl: NOW stacks above NEXT, each full width.
          - xl+: NOW | NEXT | Stats column, three equal columns. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <NowZone items={summary?.activeReservations || []} onPick={handlePick} />
        <NextZone items={summary?.upcomingReservations || []} onPick={handlePick} />
        <div className="hidden xl:flex xl:flex-col gap-3">
          <StatTile
            label={t('dashboard.stats.today')}
            value={summary?.todayCount}
            accent="primary"
            href="/dashboard/reservations"
          />
          <StatTile
            label={t('dashboard.stats.pending')}
            value={summary?.pendingConfirmationCount}
            accent="amber"
            href="/dashboard/reservations?tab=pending"
          />
          <StatTile
            label={t('dashboard.stats.occupied')}
            value={summary?.occupiedCount}
            accent="blue"
            href="/dashboard/live"
          />
        </div>
      </div>

      {/* SEARCH — full width at every breakpoint. */}
      <SearchZone onPick={handlePick} />

      <ReservationDetailPopup
        reservation={popupReservation}
        isOpen={popupOpen}
        onClose={() => { setPopupOpen(false); setPopupReservation(null) }}
        onAction={(_actionType, _r) => {
          // The popup handles its own actions internally (noshow, edit).
          // For others (confirm/reject/cancel/seat/etc.) the parent
          // closes the popup and trigger a quiet refetch — actual action
          // wiring lands in subsequent items. Dashboard is mostly a
          // jumping-off point; the heavier action surfaces (Live,
          // Reservations) own those routes.
          setPopupOpen(false)
          setPopupReservation(null)
          load(true)
        }}
      />
    </div>
  )
}
