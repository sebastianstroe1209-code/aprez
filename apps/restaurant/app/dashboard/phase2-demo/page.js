'use client'

// C6 Phase 2 standalone verification harness.
// Mounts each shared component once with toggles for QA. Not linked from
// the sidebar — reach via /dashboard/phase2-demo directly.
//
// Phase 3 will delete this file once the components are wired into the
// real flows (Reservations, Live, Calendar, Dashboard).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import ToastProvider, { useToast } from '../../../components/ui/ToastProvider'
import ActionButton from '../../../components/ui/ActionButton'
import ReservationDetailPopup from '../../../components/ReservationDetailPopup'
import QuickAddReservation from '../../../components/QuickAddReservation'

// One sample reservation per status so QA can exercise every state-action
// matrix row from §3.1.
const SAMPLE_RESERVATIONS = [
  {
    id: 'demo-pending',
    status: 'PENDING',
    guestName: 'Maria Popescu',
    partySize: 4,
    time: '19:30',
    date: new Date().toISOString(),
    specialRequests: 'Aniversare — masă lângă fereastră',
    user: { firstName: 'Maria', lastName: 'Popescu', phone: '+40751234567' },
  },
  {
    id: 'demo-confirmed-with-table',
    status: 'CONFIRMED',
    guestName: 'Andrei Ionescu',
    partySize: 2,
    time: '20:00',
    date: new Date().toISOString(),
    table: { id: 't1', tableNumber: 5, seatCount: 2 },
  },
  {
    id: 'demo-confirmed-no-table',
    status: 'CONFIRMED',
    guestName: 'Elena Dumitrescu',
    partySize: 6,
    time: '21:00',
    date: new Date().toISOString(),
    tableId: null,
  },
  {
    id: 'demo-autoconfirmed',
    status: 'AUTO_CONFIRMED',
    guestName: 'Cristina Vasile',
    partySize: 3,
    time: '18:30',
    date: new Date().toISOString(),
    table: { id: 't2', tableNumber: 9, seatCount: 4 },
    specialRequests: 'Alergie la arahide',
  },
  {
    id: 'demo-awaiting',
    status: 'AWAITING_GUEST',
    guestName: 'Smith ×4',
    partySize: 4,
    time: '19:00',
    date: new Date().toISOString(),
    table: { id: 't3', tableNumber: 11, seatCount: 4 },
    secondsLate: 12 * 60, // 12 min — triggers the late badge
  },
  {
    id: 'demo-occupied',
    status: 'OCCUPIED',
    guestName: 'Radu Nemțeanu',
    partySize: 2,
    time: '18:00',
    date: new Date().toISOString(),
    table: { id: 't4', tableNumber: 3, seatCount: 2 },
  },
  {
    id: 'demo-completed',
    status: 'COMPLETED',
    guestName: 'Tudor Ionescu',
    partySize: 5,
    time: '13:00',
    date: new Date().toISOString(),
  },
  {
    id: 'demo-cancelled',
    status: 'CANCELLED',
    guestName: 'Ana Marin',
    partySize: 2,
    time: '20:30',
    date: new Date().toISOString(),
  },
  {
    id: 'demo-noshow',
    status: 'NO_SHOW',
    guestName: 'Dan Pop',
    partySize: 3,
    time: '19:30',
    date: new Date().toISOString(),
  },
]

const ACTION_VARIANTS = [
  'confirm', 'reject', 'seat', 'pickTable',
  'reassignTable', 'cancel', 'complete', 'edit', 'noshow',
]

function Inner() {
  const t = useTranslations()
  const { show } = useToast()
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupReservation, setPopupReservation] = useState(SAMPLE_RESERVATIONS[0])
  const [quickAddOpen, setQuickAddOpen] = useState(false)

  return (
    <div className="space-y-12 max-w-3xl">
      <header>
        <h1 className="text-3xl font-bold mb-1">Phase 2 demo</h1>
        <p className="text-sm text-gray-500">
          Standalone verification of C6 shared infrastructure. Not linked
          from sidebar; deleted in Phase 3.
        </p>
      </header>

      {/* Toast */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Toast</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => show('Info toast — auto dismisses in 8s', { variant: 'info' })}
            className="px-3 py-2 rounded bg-blue-100 text-blue-900 min-h-[44px]">Info</button>
          <button onClick={() => show('Success toast', { variant: 'success' })}
            className="px-3 py-2 rounded bg-green-100 text-green-900 min-h-[44px]">Success</button>
          <button onClick={() => show('Warning toast', { variant: 'warning' })}
            className="px-3 py-2 rounded bg-amber-100 text-amber-900 min-h-[44px]">Warning</button>
          <button onClick={() => show('Error toast', { variant: 'error' })}
            className="px-3 py-2 rounded bg-red-100 text-red-900 min-h-[44px]">Error</button>
          <button onClick={() => show('Marked no-show — Smith ×4', {
            variant: 'undo',
            actionLabel: t('toast.undoLabel'),
            onAction: () => show('Reverted', { variant: 'success' }),
            durationMs: 10000,
          })} className="px-3 py-2 rounded bg-gray-900 text-white min-h-[44px]">Undo (10s)</button>
          <button onClick={() => {
            for (let i = 0; i < 5; i++) show(`Stacked toast #${i + 1}`, { variant: 'info' })
          }} className="px-3 py-2 rounded bg-gray-100 text-gray-800 min-h-[44px]">Stack 5 (max 3 visible)</button>
        </div>
      </section>

      {/* ActionButton */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">ActionButton</h2>
        <p className="text-sm text-gray-500">
          Ambiguous variants (confirm / seat / pickTable / complete) render subtext.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ACTION_VARIANTS.map((v) => (
            <ActionButton key={v} variant={v} onClick={() => show(`Clicked: ${v}`, { variant: 'info' })} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <ActionButton variant="confirm" loading />
          <ActionButton variant="confirm" disabled />
        </div>
      </section>

      {/* ReservationDetailPopup */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">ReservationDetailPopup</h2>
        <p className="text-sm text-gray-500">
          Click any sample to open the popup. Each row exercises a different
          §3.1 state-action matrix entry.
        </p>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_RESERVATIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => { setPopupReservation(r); setPopupOpen(true) }}
              className="px-3 py-2 rounded bg-gray-100 text-gray-800 text-sm min-h-[44px]"
            >
              {r.status}: {r.guestName}
            </button>
          ))}
        </div>
      </section>

      {/* QuickAddReservation */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">QuickAddReservation</h2>
        <p className="text-sm text-gray-500">
          Hits real backend: fetches /profile for smart defaults, queries
          /availability live as you type, POSTs /reservations on save.
        </p>
        <button
          onClick={() => setQuickAddOpen(true)}
          className="px-4 py-3 rounded bg-primary text-white font-semibold min-h-[48px]"
        >
          Open Quick Add
        </button>
      </section>

      {/* Mounted popups (only render when open) */}
      <ReservationDetailPopup
        reservation={popupReservation}
        isOpen={popupOpen}
        onClose={() => setPopupOpen(false)}
        onAction={(actionType, r) => show(`Action: ${actionType} on ${r.guestName}`, { variant: 'info' })}
      />
      <QuickAddReservation
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      />
    </div>
  )
}

export default function Phase2DemoPage() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  )
}
