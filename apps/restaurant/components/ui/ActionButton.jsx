'use client'

// Shared action button for reservation/table actions.
// Per memory/waiter_ux_strategy.md §3.11: always-visible inline subtext for
// ambiguous variants (confirm, seat, pickTable, complete) — tablets don't
// have hover so tooltips don't work. Unambiguous variants (cancel, reject,
// edit, noshow, reassignTable) render label-only to preserve density.
//
// All copy goes through i18n. Pass i18n keys (e.g. "actions.confirm") as
// `label` and optional `subtext`; the component resolves via useTranslations.
//
// Touch target: minimum 48px tall per §4.5 (Apple HIG 44, Android 48).

import { useTranslations } from 'next-intl'

// Subtext is opt-in but auto-defaults for the ambiguous variants when the
// caller doesn't pass one. Unambiguous variants intentionally render none.
const AMBIGUOUS_VARIANTS = new Set(['confirm', 'seat', 'pickTable', 'complete'])

const DEFAULT_SUBTEXT_KEY = {
  confirm: 'actions.confirmSubtext',
  seat: 'actions.seatSubtext',
  pickTable: 'actions.pickTableSubtext',
  complete: 'actions.completeSubtext',
}

const VARIANT_STYLES = {
  confirm:        'bg-primary text-white hover:bg-primary-dark',
  reject:         'bg-red-600 text-white hover:bg-red-700',
  seat:           'bg-blue-600 text-white hover:bg-blue-700',
  pickTable:      'bg-primary text-white hover:bg-primary-dark',
  reassignTable:  'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300',
  cancel:         'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300',
  complete:       'bg-green-600 text-white hover:bg-green-700',
  edit:           'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300',
  noshow:         'bg-orange-100 text-orange-900 hover:bg-orange-200 border border-orange-300',
}

const DEFAULT_LABEL_KEY = {
  confirm: 'actions.confirm',
  reject: 'actions.reject',
  seat: 'actions.seat',
  pickTable: 'actions.pickTable',
  reassignTable: 'actions.reassignTable',
  cancel: 'actions.cancel',
  complete: 'actions.complete',
  edit: 'actions.edit',
  noshow: 'actions.noshow',
}

export default function ActionButton({
  variant,
  label,         // i18n key; falls back to DEFAULT_LABEL_KEY[variant]
  subtext,       // i18n key; falls back to DEFAULT_SUBTEXT_KEY[variant] for ambiguous variants only
  onClick,
  disabled = false,
  loading = false,
  className = '',
}) {
  const t = useTranslations()
  const labelKey = label || DEFAULT_LABEL_KEY[variant]
  // Tier E commit 1: only fall back to the default subtext when the
  // caller passes `subtext === undefined`. Passing `null` (or '') now
  // suppresses the subtext entirely — used by the modification-approve
  // button so it doesn't carry "approve booking" subtext under
  // "Approve change".
  const subtextKey = subtext !== undefined
    ? subtext
    : (AMBIGUOUS_VARIANTS.has(variant) ? DEFAULT_SUBTEXT_KEY[variant] : null)
  const variantClass = VARIANT_STYLES[variant] || VARIANT_STYLES.cancel

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${variantClass} rounded-md px-4 py-3 min-h-[48px] font-semibold text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex flex-col items-center justify-center leading-tight ${className}`}
    >
      <span>{loading ? '…' : (labelKey ? t(labelKey) : '')}</span>
      {subtextKey && (
        <span className="text-[11px] font-normal opacity-80 mt-0.5">{t(subtextKey)}</span>
      )}
    </button>
  )
}
