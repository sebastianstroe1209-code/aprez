'use client'

// Individual toast item, rendered by ToastProvider's stack.
// Visual variants per the strategy doc and §6 design tokens.

const VARIANT_STYLES = {
  info:    'bg-blue-50    border-blue-200    text-blue-900',
  success: 'bg-green-50   border-green-200   text-green-900',
  warning: 'bg-amber-50   border-amber-200   text-amber-900',
  error:   'bg-red-50     border-red-200     text-red-900',
  undo:    'bg-gray-900   border-gray-700    text-white',
}

export default function Toast({ message, variant, actionLabel, onAction, onDismiss }) {
  const variantClass = VARIANT_STYLES[variant] || VARIANT_STYLES.info

  const handleAction = (e) => {
    e.stopPropagation()
    if (onAction) onAction()
    onDismiss()
  }

  return (
    <div
      role="status"
      onClick={onDismiss}
      className={`${variantClass} pointer-events-auto cursor-pointer border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 min-h-[48px]`}
    >
      <span className="flex-1 text-sm font-medium leading-tight">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={handleAction}
          className={`shrink-0 px-3 py-1.5 rounded font-semibold text-sm min-h-[36px] ${
            variant === 'undo'
              ? 'bg-white/15 hover:bg-white/25 text-white'
              : 'underline underline-offset-2 hover:opacity-80'
          }`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
