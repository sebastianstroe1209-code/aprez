'use client'

// Tier G4 (SPEC §6.3) — service-period selector. Mounted on the Live
// floor plan to filter which reservation overlays render to the
// currently-selected service window ("Lunch", "Dinner", …). Built as a
// shared component so the Calendar (§6.4) can adopt the same control
// later without duplicating the markup. Renders nothing when the
// restaurant has no configured service periods.

import { useTranslations } from 'next-intl'

export default function ServicePeriodFilter({ periods = [], value = '', onChange }) {
  const t = useTranslations()
  if (!periods.length) return null
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{t('servicePeriodFilter.label')}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-56"
      >
        <option value="">{t('servicePeriodFilter.all')}</option>
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {(p.nameEn || p.nameRo)} · {p.startTime}–{p.endTime}
          </option>
        ))}
      </select>
    </div>
  )
}
