# Socket.IO Event Contract (§5a)

Canonical payload shapes for the seven `§5a` Socket.IO events emitted by the
backend. Subscribers (restaurant / admin / mobile) treat these shapes as
stable — adding fields is backward-compatible, removing or renaming fields
is breaking.

Reference: `memory/waiter_ux_strategy.md` §5a (emit list) and §5b (freshness
model). C4 implemented the emit surface; C6 Phase 1 locked the shapes so
Phase 2 components can subscribe without coupling to a specific emitter
call site.

## Rooms

- `restaurant:{restaurantId}` — restaurant staff (JWT role=restaurant) auto-joins this room on connect via the handshake middleware in `socket/handlers.js`.
- `user:{userId}` — diner (JWT role=user) auto-joins this room.
- `admin:global` — admin (JWT role=admin) auto-joins this room. Currently receives `reservation:pending-created` only.

## Events

### `reservation:created`
**Rooms:** `restaurant:{restaurantId}`
**Emitted at:** diner POST `/api/reservations` (`reservation.routes.js`) AND staff manual POST `/api/restaurant/reservations` (`restaurantPlatform.routes.js`).
**Payload:** the freshly-created reservation row as Prisma returns it. Common subset subscribers can rely on:
```
{
  id: string,
  restaurantId: string,
  userId: string | null,        // null for staff-created (Manual)
  date: ISO date string,
  time: "HH:mm",
  endTime: "HH:mm",
  partySize: number,
  status: "PENDING" | "AUTO_CONFIRMED" | ...,
  source: "APP" | "MANUAL",
  // Staff-create variant additionally includes:
  guestName?: string, guestPhone?: string, specialRequests?: string | null,
  table?: { id, tableNumber, seatCount } | null
}
```

### `reservation:pending-created`
**Rooms:** `restaurant:{restaurantId}` AND `admin:global`
**Emitted at:** diner POST `/api/reservations` ONLY when `status === 'PENDING'` (i.e. the reservation did not auto-confirm and the restaurant must review).
**Payload:** same shape as `reservation:created`. Admin payload additionally carries `restaurantId` at the top level (already present in the reservation row).

### `reservation:updated`
**Rooms:** `restaurant:{restaurantId}` AND `user:{userId}` (when the reservation has a userId — staff-created Manual reservations only emit to the restaurant room).
**Emitted at:** every reservation mutation that doesn't transition to Cancelled:
- `PUT /api/restaurant/reservations/:id/confirm`
- `PUT /api/restaurant/reservations/:id/assign-table`
- `PUT /api/restaurant/reservations/:id` (generic edit — C6 Phase 1)
- `PUT /api/restaurant/reservations/:id/seat`
- `PUT /api/restaurant/reservations/:id/complete`
- `PUT /api/restaurant/reservations/:id/no-show`
- `PUT /api/restaurant/modifications/:id/approve`
- `PUT /api/restaurant/modifications/:id/reject`
- `POST /api/reservations/:id/modify` (diner modification request)

**Payload:** the updated reservation row. Modification-related variants additionally carry `modificationPending: { ... } | null` or `modificationRejected: { id, resolvedAt }` so clients can render the modification's lifecycle without a separate fetch.

### `reservation:cancelled`
**Rooms:** `restaurant:{restaurantId}` AND `user:{userId}` (when set).
**Emitted at:** any path that transitions a reservation to Cancelled:
- `PUT /api/reservations/:id/cancel` (diner)
- `PUT /api/restaurant/reservations/:id/cancel` (staff)
- `PUT /api/restaurant/reservations/:id/reject` (staff rejects a pending — additionally sets `reason: "rejected"`)

**Payload:** the cancelled reservation row plus `cancelledBy: "user" | "restaurant"` and (for rejects) `reason: "rejected"`.

### `table:status-changed`
**Rooms:** `restaurant:{restaurantId}`
**Emitted at:**
- `PUT /api/restaurant/tables/:id/status` (any status change)
- `PUT /api/restaurant/tables/:id/seat` (FREE → OCCUPIED via walk-in)
- `PUT /api/restaurant/reservations/:id/seat` (FREE/AWAITING_GUEST → OCCUPIED)
- `PUT /api/restaurant/reservations/:id/complete` (OCCUPIED → FREE)
- `PUT /api/restaurant/reservations/:id/no-show` (AWAITING_GUEST → FREE)
- `socket.on('table:updateStatus')` shortcut handler
- 60s timer auto-transitions (FREE → ARRIVING_SOON 1h before; → AWAITING_GUEST at reservation time)

**Payload:**
```
{
  tableId: string,
  newStatus: "FREE" | "OCCUPIED" | "ARRIVING_SOON" | "AWAITING_GUEST" | "OUT_OF_SERVICE",
  statusChangedAt: ISO timestamp,
  // shortcut handler additionally carries:
  guestCount?: number
}
```

### `walkin:created`
**Rooms:** `restaurant:{restaurantId}`
**Emitted at:** `PUT /api/restaurant/tables/:id/seat` (alongside `table:status-changed`).
**Payload:**
```
{
  tableId: string,
  activityId: string,    // TableActivity row id — for §6.4 calendar lookups
  partySize: number,
  startedAt: ISO timestamp
}
```

### `walkin:ended`
**Rooms:** `restaurant:{restaurantId}`
**Emitted at:** `PUT /api/restaurant/tables/:id/status` when the transition is OCCUPIED → FREE. Reservation lifecycle paths (`/complete`, `/no-show`) do NOT emit `walkin:ended` because they free the table via Prisma directly, not through the generic status endpoint — the dedicated `reservation:updated` event covers the reservation-side change.
**Payload:**
```
{
  tableId: string,
  activityId: string | null,    // matching TableActivity row id (null if no open WALK_IN found)
  endedAt: ISO timestamp
}
```

## Subscriber guidance

- **Surgical updates only.** Patch the affected item in local state; do NOT refetch the whole list on every event. Full refetch is reserved for socket reconnect and `visibilitychange → visible` per §4.4.
- **Tolerate optional fields.** Restaurant-side subscribers may receive payloads that have or omit `user`, `guestName`, `specialRequests` depending on which endpoint emitted the event. Render defensively.
- **`reservation:updated` after `reservation:created`.** Some flows (diner POST) emit `reservation:created` to the restaurant room and `reservation:updated` to the user room in the same tick. Subscribers in both rooms see the new reservation via two events — dedup by `id`.
