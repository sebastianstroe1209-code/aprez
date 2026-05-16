'use client'

// Small reusable stat tile for the C6 P3-7 Dashboard rebuild.
// Three of these render in a row on tablet/phone, stacked in a sidebar
// at desktop. Clickable when an href is provided.

import Link from 'next/link'

const ACCENT_CLASSES = {
  primary: 'border-l-primary',
  amber:   'border-l-amber-400',
  blue:    'border-l-blue-500',
  gray:    'border-l-gray-300',
}

export default function StatTile({ label, value, accent = 'gray', href }) {
  const accentClass = ACCENT_CLASSES[accent] || ACCENT_CLASSES.gray
  const body = (
    <div
      className={`bg-white rounded-lg shadow-sm border-l-4 ${accentClass} p-4 min-h-[88px] flex flex-col justify-center transition-shadow ${
        href ? 'hover:shadow-md cursor-pointer' : ''
      }`}
    >
      <div className="text-xs text-gray-500 font-medium leading-tight">{label}</div>
      <div className="text-3xl font-bold text-gray-900 tabular-nums mt-1">{value ?? '—'}</div>
    </div>
  )
  if (!href) return body
  return <Link href={href} className="block">{body}</Link>
}
