// ApRez brand color tokens — single source of truth for web + mobile.
// Tailwind configs (Node, CommonJS) and mobile (Metro, ES interop) both consume this.

const Colors = {
  // Brand
  primary: '#22c55e',
  primaryDark: '#16a34a',
  primaryLight: '#bbf7d0',
  primaryBg: '#f0fdf4',

  // Surfaces
  background: '#f8fafc',
  surface: '#ffffff',
  card: '#ffffff',

  // Text
  text: '#1e293b',
  textSecondary: '#64748b',
  textLight: '#94a3b8',
  textOnPrimary: '#ffffff',

  // Borders
  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  // Feedback
  error: '#ef4444',
  errorBg: '#fef2f2',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  info: '#3b82f6',
  infoBg: '#eff6ff',

  // Table statuses
  free: '#22c55e',
  occupied: '#ef4444',
  arrivingSoon: '#f97316',
  awaitingGuest: '#ec4899',
  outOfService: '#6b7280',

  // Reservation statuses
  pending: '#f59e0b',
  confirmed: '#22c55e',
  cancelled: '#ef4444',
  completed: '#6b7280',
  noShow: '#ef4444',

  // Feedback-banner tints (mobile) — Tier H3. The amber rejected-
  // modification + reconnect banners in the diner reservation screens
  // previously carried these as inline hex. The slate "completed"
  // status background reuses `borderLight` (#f1f5f9) — no new token.
  warnTint: '#fef3c7',           // amber-100 — banner background
  warnTintBorder: '#fcd34d',     // amber-300 — modification-rejected card border
  warnTintBorderSoft: '#fde68a', // amber-200 — reconnect banner border
  warnTintText: '#78350f',       // amber-900 — banner text

  shadow: 'rgba(0, 0, 0, 0.08)',
};

// Tailwind theme.extend.colors map. Keys here become utility classes
// (e.g. `primary` → `bg-primary text-primary border-primary`).
const tailwindColors = {
  // Brand
  primary: Colors.primary,
  'primary-dark': Colors.primaryDark,
  'primary-light': Colors.primaryLight,
  'primary-bg': Colors.primaryBg,

  // Surfaces / text / borders
  surface: Colors.surface,
  card: Colors.card,
  'border-default': Colors.border,
  'border-light': Colors.borderLight,
  fg: Colors.text,
  'fg-secondary': Colors.textSecondary,
  'fg-muted': Colors.textLight,

  // Feedback
  error: Colors.error,
  'error-bg': Colors.errorBg,
  warning: Colors.warning,
  'warning-bg': Colors.warningBg,
  info: Colors.info,
  'info-bg': Colors.infoBg,

  // Table statuses (canonical names)
  'table-free': Colors.free,
  'table-occupied': Colors.occupied,
  'table-arriving': Colors.arrivingSoon,
  'table-awaiting': Colors.awaitingGuest,
  'table-out': Colors.outOfService,

  // Reservation statuses
  'res-pending': Colors.pending,
  'res-confirmed': Colors.confirmed,
  'res-cancelled': Colors.cancelled,
  'res-completed': Colors.completed,
  'res-noshow': Colors.noShow,

  // Status badge tints (Tier H3) — bg + fg pairs for reservation /
  // table status badges. Centralizes the bg-{c}-100 / text-{c}-{n}
  // pairs previously scattered across NextZone's STATUS_TONE map,
  // the Reservations page's statusBadgeColor map, and inline status
  // chips (ReservationDetailPopup, admin team / restaurants).
  'status-pending-bg': '#fef9c3',   'status-pending-fg': '#854d0e',
  'status-confirmed-bg': '#dcfce7', 'status-confirmed-fg': '#166534',
  'status-awaiting-bg': '#fce7f3',  'status-awaiting-fg': '#831843',
  'status-occupied-bg': '#fee2e2',  'status-occupied-fg': '#7f1d1d',
  'status-cancelled-bg': '#fee2e2', 'status-cancelled-fg': '#991b1b',
  'status-noshow-bg': '#ffedd5',    'status-noshow-fg': '#9a3412',
  'status-neutral-bg': '#f3f4f6',   'status-neutral-fg': '#374151',
  'status-info-bg': '#dbeafe',      'status-info-fg': '#1e40af',

  // Feedback-banner tints (Tier H3) — bg / border / fg trios for the
  // inline alert banners. The error/warning/info tokens above are
  // accent colors (red-500 etc.); these are the lighter banner tints
  // (the red-100 / red-400 / red-700 family) and intentionally distinct.
  'alert-error-bg': '#fee2e2',   'alert-error-border': '#f87171',   'alert-error-fg': '#b91c1c',
  'alert-success-bg': '#dcfce7', 'alert-success-border': '#4ade80', 'alert-success-fg': '#15803d',
  'alert-warning-bg': '#fef3c7', 'alert-warning-border': '#fcd34d', 'alert-warning-fg': '#78350f',

  // Action button colors (Tier H3) — solid fill + hover for the
  // semantic action buttons. `confirm` / `pickTable` keep the brand
  // `primary` / `primary-dark` tokens above (already tokenized).
  'action-danger': '#dc2626',  'action-danger-hover': '#b91c1c',
  'action-info': '#2563eb',    'action-info-hover': '#1d4ed8',
  'action-success': '#16a34a', 'action-success-hover': '#15803d',
  'action-warning': '#d97706', 'action-warning-hover': '#b45309',

  // Sidebar — dark navy nav-bar background, consumed by both Next apps
  // via the `bg-sidebar` class. Deliberately outside the brand/status
  // palette (it is app chrome, not a brand or feedback color); `sidebar`
  // is its canonical token.
  sidebar: '#1a1a2e',
};

module.exports = { Colors, tailwindColors };
