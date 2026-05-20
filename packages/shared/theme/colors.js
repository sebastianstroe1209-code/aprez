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

  // Sidebar — dark navy nav-bar background, consumed by both Next apps
  // via the `bg-sidebar` class. Deliberately outside the brand/status
  // palette (it is app chrome, not a brand or feedback color); `sidebar`
  // is its canonical token.
  sidebar: '#1a1a2e',
};

module.exports = { Colors, tailwindColors };
