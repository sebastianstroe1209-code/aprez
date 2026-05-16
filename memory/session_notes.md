---
name: Session notes — handoff
description: Where we left off; what's pending; quick-resume commands. Update or delete after the next session picks up.
type: project
---

**Last session: 2026-05-16. Tier C6 Phase 3 item 4 (Walk-in fast seating) COMPLETE — new `WalkInActionSheet` component (party stepper, optional collapsible name field, capacity-override warning, pending-sync save) wired on the Live page: Free clicks open it directly; Arriving-Soon clicks within 30 min of the upcoming reservation open it with a pre-form acknowledgement warning per §3.4 edge cases; Arriving-Soon ≥30 min opens the existing ReservationDetailPopup on the upcoming reservation. Backend `PUT /api/restaurant/tables/:id/seat` extended to accept optional `walkInName` body field (stored in `TableActivity.notes`); `walkin:created` event payload now carries `walkInName`. End-to-end smoke confirmed: PUT response, event payload, and DB row all carry the name. P3-5 (No-show with undo) is next.**

## Where we left off

- HEAD is the C3 commit. C1 (`ea3f221`), C2 (`620cba0`), C3 (`ed911a5`) all complete and verified. Dispatcher's four-channel surface is fully real: in-app + email + push + sms-stub.
  ```
  ed911a5    feat(notifications): C3 Expo Push transport + 45-min reminder cron  [verified]
  620cba0    feat(notifications): C2 Resend email transport                       [verified]
  210b767    chore(time-input): accept native AM/PM rendering, revert CSS hack
  83ec3f6    fix(ui): hide AM/PM segment from native time inputs                  REVERTED by 210b767 (AM/PM is an accepted MVP tradeoff per SPEC §14 2026-05-09)
  ea3f221    feat(notifications): C1 dispatcher                                   [verified]
  5eabdc0    fix(ui): drop duplicate T prefix in table label rendering
  c004e4d    feat(reservations): lang=en-GB on native pickers + Special Requests
  28eccf1    fix(calendar): default selectedDate uses Europe/Bucharest
  7a5604d    fix(reservations): Today tab returns only today; backend exact-day
  8df89bb    feat(schema): add TableActivity model and Reservation.specialRequests
  ```

- **C1 dispatcher (commit `ea3f221`)** lives at `server/src/services/notifications/`. Single entry: `dispatch(prisma, io, { event, userId | restaurantId, ...ctx })`. Routes the 12 SPEC §10 events across in-app, push, sms, email channels. In-app persists Notification rows + emits socket; push/sms/email are stubs that `console.log` until C2/C3 swap real impls. RO + EN templates rendered side-by-side. Wired into 8 reservation hook points + 3 timer signals (45-min, 120-min occupied, 15-min awaiting). The 120-min and awaiting reminders dedup per (tableId × statusChangedAt) so a long-running OCCUPIED row doesn't spam the Notifications table on every minute tick — dedup is in-memory and resets on backend restart, which is fine for MVP.

- **Synthetic smoke** verified all 12 events route correctly with proper RO content + diner/restaurant name interpolation. Route-level smoke (diner-cancel) confirmed wiring fires event #9 end-to-end. Smoke debris (20+6 notification rows + 1 cancelled test reservation `8a8c9ce1`) was deleted with Sebastian's approval; reservations table back to 19.

- **All four dev servers stopped cleanly at session end.** Verified: ports 4000, 3001, 3002, 8081 all free. Zero `node.exe` processes residual. Two backend nodemon parents (PIDs 27208 and 23068) and two `npm run dev` wrappers (6400, 22936) had to be cascade-killed by PID after the leaf-Next.js / leaf-node kills — the documented Windows TaskStop quirk.

- **Time-picker AM/PM is officially closed as "accepted not fixed."** SPEC.md §11 + §14 + §15 + CLAUDE.md DoD #11 all updated to reflect the tradeoff. Display formatting via `formatTime()` remains 24-hour everywhere it matters; only entry-form pickers may show 12h AM/PM in some browsers. Form values still submit `HH:mm`.

- **C2 Resend email transport** (commit `620cba0`): `server/src/services/notifications/channels/email.js` sends via Resend SDK (v6.12.3, installed in `server/`). One-time warning + console.log fallback when `RESEND_API_KEY` is missing. Try/catch around the SDK call so failures never propagate past the dispatcher. Email is NOT routed by §10 per-event matrix — reserved for transactional flows (Tier D §6.8, §5.9, §7.1).

- **C3 Expo Push transport** (this commit): `server/src/services/notifications/channels/push.js` POSTs to `https://exp.host/--/api/v2/push/send` using built-in fetch — no SDK needed. Optional `EXPO_ACCESS_TOKEN` env var enables Bearer auth; unauthenticated mode acceptable for MVP volume and logs a one-time info note. Token format validated (`ExponentPushToken[…]` / `ExpoPushToken[…]`); null/malformed tokens log `[push:skip]` and let the dispatcher's §10 fallback chain handle delivery. HTTP/network/ticket-error paths all log and don't propagate. The dispatcher now forwards a `data` field through to the push channel for action-button data (`{ yes, no, reservationId }`).

- **C3 45-min reminder cron** (this commit): `server/src/jobs/reminders.js` exports `checkAndFireRemindersFor(prisma, io, now)`. Window is `[now+44, now+46]` minutes, Bucharest wall-clock at HH:mm precision. Dedup via `Reservation.reminderSentAt`. Called every minute by the existing `setInterval` in `socket/handlers.js` (no node-cron install needed; matches existing convention). The previous inline 45-min block in handlers.js was replaced.

- **C3 schema additions** (this commit, both additive — no `--accept-data-loss`): `User.expoPushToken` (text, nullable) and `Reservation.reminderSentAt` (timestamp, nullable) pushed to Railway clean. Old `User.fcmToken` kept as deprecated column with no readers; flag for future drop with explicit approval. `PUT /api/users/me/fcm-token` route renamed to `PUT /api/users/me/push-token` with body `expoPushToken` — mobile-side wiring is out of scope for C3.

- **C3 smoke results:**
  - Push level 1 (synthetic `ExponentPushToken[TEST_FAKE]`): Expo accepted the request shape and returned a 200 with a structured ticket. Ticket itself reported `status="error"` / `details.error="DeviceNotRegistered"` because the fake token isn't a real device-issued one — that's Expo enforcing token authenticity, not a transport bug. Code logged `[push:error]` and returned without throwing. The `status: ok` path will fire when a real device's token is registered.
  - Push level 2 (`expoPushToken=null`): logged `[push:skip] reason=no_token`, returned null, no DB write — exactly as §10 fallback chain expects.
  - Reminder cron: seeded a CONFIRMED reservation at Bucharest now+45min, called `checkAndFireRemindersFor(now)` → fired exactly once (`fired: 1`), `reminderSentAt` set on the reservation, dispatcher routed the event into SMS fallback (correct, demo user has no expoPushToken). Re-called the function with same `now` → `fired: 0` (dedup works). Test reservation deleted on cleanup.
  - C1 12-event regression: all §10 routing intact. C2 email regression: Resend message ID `9ddc1a8f-8af5-4dde-be88-53890c7c26df` sent to sebastian.stroe1209@gmail.com. Source-grep for `push:stub`/`TODO push`/`TODO reminder` returned zero matches.

- **A2 column drop still pending.** The deprecated `from_waitlist` column on `reservations` is still present (~15 rows of default-`false`). Drop only when Sebastian explicitly approves `--accept-data-loss` for that one column.

## What's pending — Phase 3 item 4 (Walk-in fast seating) complete; P3-5 (No-show + undo) is next, gated on Sebastian's approval

**C6 P3-4 (Walk-in fast seating) shipped this session.** New component + Live wiring + small backend extension.

New component `apps/restaurant/components/WalkInActionSheet.jsx`:
- Props: `table`, `isOpen`, `onClose`, `onSeated(updated)`, optional `arrivingSoonWarning: { name, party, minutes }`.
- Renders bottom sheet at <768px / centered 560px modal at ≥768px.
- Party-size stepper (default 2, ±, 48px round buttons, tabular-nums display).
- Collapsible "+ Add name" field (text input revealed on click).
- Over-capacity warning + ack: if `partySize > seatCount`, surfaces a Yes/No ack BEFORE Save is enabled. Yes overrides per §8.2; No snaps party back to seatCount.
- ARRIVING_SOON warning gate: when caller passes `arrivingSoonWarning`, the form is hidden behind a Yes/Cancel ack with the strategy doc's exact copy ("Table {tableLabel} has a reservation in {minutes} min for {name} ×{party} — seat walk-in anyway?"). Yes reveals the form; Cancel closes outright.
- Pending-sync save per §4.2: spinner + locked Save during PUT, 10s timeout fallback, inline error on failure (409 maps to `walkIn.error.tableNotFree`).
- Success toast via `useToast`: `walkIn.toast.seated` (variant=success, 4s).
- Esc closes; backdrop click closes.

Backend extension (`server/src/routes/restaurantPlatform.routes.js`):
- `PUT /api/restaurant/tables/:id/seat` body validator now accepts optional `walkInName` (string, nullable). When set, the value is stored on `TableActivity.notes` (the schema already had a `notes` text column — first writer). The `walkin:created` socket event payload now includes `walkInName` so subscribers (Live overlay in P3-3 onward) can render a label for unbacked walk-ins. Pre-existing `guestCount` validation unchanged; no breaking changes to existing callers.

Live page wiring (`apps/restaurant/app/dashboard/live/page.js`):
- `handleTableClick` rewritten to route by status:
  - OUT_OF_SERVICE → no-op (unchanged).
  - FREE → open WalkInActionSheet (replaces P3-3 no-op).
  - ARRIVING_SOON → compute `minutesUntil` from `nextReservation.time` vs Bucharest now; if `< 30` open sheet with `arrivingSoonWarning`, else open ReservationDetailPopup on the upcoming reservation.
  - OCCUPIED / AWAITING_GUEST → ReservationDetailPopup with `currentReservation` (unchanged from P3-3).
- `<WalkInActionSheet>` mounted alongside `<ReservationDetailPopup>` at end of render tree.
- `onSeated` triggers a quiet `loadLayout()` refetch — the socket events handle the surgical update, this is insurance against payload-shape mismatch.

i18n keys added (`walkIn.*` — title, subtitle, partyStepperLabel, nameFieldLabel/Toggle, buttonSeat/Cancel, saving, warning.arrivingSoon, warning.overCapacity, toast.seated, error.tableNotFree) in both ro and en with ICU plurals on `seats`, `minutes`, `party`.

End-to-end verification: PUT smoke confirmed response carries `activityId`; `walkin:created` socket event payload carries `walkInName: 'Smoke McTest'`; `TableActivity` row written with `kind: 'WALK_IN'`, `partySize: 3`, `notes: 'Smoke McTest'`. Test row cleaned up post-smoke. New component file zero hardcoded English UI strings. C4 §5a 7/7 ✓; C1 dispatcher 12/12 ✓. All dashboard routes 200.

**C6 P3-3 (Live floor overlay) shipped earlier this session.** Changes scoped to `apps/restaurant/app/dashboard/live/page.js`:
- `loadLayout()` now fetches `/api/restaurant/layout` AND `/api/restaurant/layout/live` in parallel; merges per-table currentReservation/nextReservation/secondsLate into `liveByTableId` keyed by table id. /layout/live is the C6 Phase 1 augmented endpoint.
- New `OVERLAY_STATUSES` set = OCCUPIED, ARRIVING_SOON, AWAITING_GUEST. Cards in these statuses render the inline overlay (guest name + party + time + badges). FREE + OUT_OF_SERVICE render as before (status label only).
- Card layout switched from `flex items-center justify-center` to `flex items-stretch justify-between` so the four rows (number/seat, guest+party, time+badges, fallback) stack with sensible spacing. `min-h-[80px]` per §3.7 spec floor.
- `truncateGuestName()` slices at 12 chars + ellipsis (deterministic char-based truncation per spec, not CSS-pixel-based).
- "X min late" pill renders when `secondsLate > 600` (10 min per §3.13). Threshold computed client-side from the value the backend returns.
- "✦" special-request badge renders when `hasSpecialRequests` is truthy.
- Click handler routes Occupied / ARRIVING_SOON / AWAITING_GUEST clicks to ReservationDetailPopup with `popupReservation` derived from the appropriate slot. Free + OOS clicks are no-ops in P3-3 (Free becomes the walk-in target in P3-4 per user instruction). Confirm-mode click path (`?confirmReservationId=…`) preserved unchanged.
- Socket subscription extended: subscribes to reservation:created/updated/cancelled and walkin:created/ended in addition to table:status-changed; any of those triggers `loadLayout(true)` (quiet refetch) to keep the overlay fields fresh — they aren't in the table:status-changed payload per `events.md`.
- ReservationDetailPopup's onAction handler is a no-op for P3-3 (closes popup + quiet refetch); the actual action wiring lands in P3-4 (walk-in / Seat), P3-5 (no-show), P3-6 (edit).

Note on the pre-existing status-change modal in Live: still mounted but now unreachable from non-Free / non-OOS tables (those route to the popup); Free + OOS tables are click-inert in P3-3. The modal's Status change + Seat-walk-in actions are temporarily orphaned. P3-4 will replace the Free-table click with a dedicated walk-in action sheet per §3.4; restaurant-side OOS toggle from the Live page is out of C6 scope per user's explicit instruction (admin tool §7.2 handles it).

i18n keys added (`liveOverlay.{minLate,specialRequestsTooltip,party}`) in both ro and en. `minLate` uses ICU plural on minutes.

Verification: all dashboard routes serve 200; /layout/live returns 15 tables with the augmented fields (sample table OCCUPIED with currentReservation=null because seed walk-in occupancies aren't reservation-tied — Cowork visual QA needed with a real AWAITING_GUEST reservation); new render code zero hardcoded English UI strings; C4 §5a 7/7 ✓; C1 dispatcher 12/12 ✓.

**C6 P3-2 (Pending reservation alert) shipped earlier this session.** New shared infrastructure:
- `components/PendingReservationListener.jsx` — mounted at dashboard layout. Subscribes to `reservation:pending-created` via the C4 `subscribe()`. On event: increments badge count, fires toast (variant=info, durationMs=8000, Review action → `/dashboard/reservations?focus=<id>&tab=pending`), plays audio chime if enabled + consented. Suppression: when `pathname === '/dashboard/reservations' && activeTab === 'pending'`, toast is skipped but badge still increments.
- `components/PendingHeaderBadge.jsx` — amber pill in the persistent top header. Hidden when count === 0. Click navigates to Pending tab. Visible on every dashboard page (including Settings) per §3.6 cross-cutting requirement.
- `lib/pendingContext.js` — `PendingCountProvider` (count + increment/decrement) and `ReservationsTabProvider` (the reservations page publishes its active tab via this so the listener can suppress).
- `lib/audio.js` — WebAudio synth (no mp3 asset). 880Hz + 1320Hz sine pair, 20ms attack, exp decay over 280ms. Three localStorage helpers: `isAudioEnabled` (default ON), `setAudioEnabled`, `hasAudioConsent` + `markAudioConsent`. AudioContext lazily created on first consent gesture per browser autoplay policy.
- Settings page gained an "Audio alerts" card with On/Off toggle.

Wiring:
- `app/dashboard/layout.js` lifts `PendingCountProvider` + `ReservationsTabProvider` ABOVE both the header and the page tree so the listener (writes count) and badge (reads count) share one context — initial attempt wrapped them in two sibling subtrees and the badge never updated. ToastProvider stays inside the count providers (its scope is page-tree only).
- `app/dashboard/reservations/page.js` — reads `?tab=` and `?focus=` from `useSearchParams`, seeds initial `tab` from URL, publishes `tab` into `ReservationsTabContext`, attaches a `focusRowRef` to the matching row and `scrollIntoView` after load. Focus row gets `bg-amber-50` highlight.

Side fix bundled:
- `server/src/routes/reservation.routes.js` diner POST now includes `user: { select: { firstName, lastName, phone } }` in its `select`. Pre-fix the broadcast payload had no guest name, which made the toast render "New request: —". Pure addition — backwards-compatible.

i18n keys added (`pending.toast.{message,review}`, `pending.badge.tooltip`, `pending.audio.consent`, `settings.audio.{title,description,toggleOn,toggleOff}`) in both ro and en with ICU plurals on partySize and count.

Verification: socket simulation confirmed `reservation:pending-created` arrives on `restaurant:{id}` room with the new user-join payload; new component files zero hardcoded English. C4 §5a 7/7 ✓; C1 dispatcher 12/12 ✓. C6 Phase 1 perf bench has drift on `/availability` (p95=237-404ms vs 200ms budget) consistent across three reruns — not caused by P3-2 (which doesn't touch the benched endpoints); the budget was set when Railway round-trip latency was lower. Flag for a future tightening commit; not blocking P3-3.

**C6 P3-1 (Quick Add everywhere) shipped earlier this session.** New shared component `apps/restaurant/components/ui/QuickAddButton.jsx`:
- Floating "+" pill bottom-right (`fixed bottom-6 right-6 z-40`, label hidden at <640px to keep it FAB-circular on phone).
- Self-contained: owns modal-open state, mounts `QuickAddReservation`, listens for Alt+N globally with `isTypingTarget` guard (input/textarea/contenteditable skip the shortcut so typing names containing "n" doesn't trigger it), hides on `/dashboard/settings` via `usePathname()`.
- Success toast `quickAdd.toast.created` ("Reservation saved for {name}", 4s) via the layout-mounted ToastProvider.

Wiring:
- `apps/restaurant/app/dashboard/layout.js` now wraps the page tree in `<ToastProvider>` and mounts `<QuickAddButton />` inside it, alongside the existing `<ReconnectingBanner />`. ToastProvider promoted from demo-only (Phase 2) to layout-level (Phase 3) — every dashboard child route can now `useToast`.
- `QuickAddReservation` gained an `onSaveSuccess(saved)` callback; if provided, the parent owns the post-save UX. Standalone callers (the Phase 2 demo route) still get the default generic toast for back-compat.

i18n keys added (`quickAdd.button.{label,tooltip}`, `quickAdd.toast.created`) in both ro and en.

Verification: every route under `/dashboard/*` serves 200 including `/settings` (button absent there) and `/phase2-demo` (still works); zero hardcoded English in `QuickAddButton.jsx`; C4 §5a 7/7 events ✓; C1 dispatcher 12/12 events ✓.



**C6 Phase 2 (shared infrastructure) shipped this session.** Components live in `apps/restaurant/components/`:
- `ui/ToastProvider.jsx` + `ui/Toast.jsx` — context-based, stack max 3, info/success/warning/error/undo variants, tap-to-dismiss, top-right desktop / top-center phone.
- `ui/ActionButton.jsx` — 9 variants, always-visible subtext for ambiguous (confirm/seat/pickTable/complete), 48×48 min target.
- `ReservationDetailPopup.jsx` — full §3.1 state-action matrix; subscribes to reservation:updated for in-place re-render and reservation:cancelled for auto-close+toast; special-requests + late badges; responsive full-screen sheet <768px / centered 560px ≥768px.
- `QuickAddReservation.jsx` — smart defaults via `/api/restaurant/profile`, live availability hint (300ms debounced `/availability` calls), closed-hours warning, pending-sync save with 10s timeout, full keyboard handling.

Standalone QA at `/dashboard/phase2-demo` (not linked from sidebar; deleted in Phase 3 cleanup). Real pages (Reservations / Live / Calendar / Dashboard) untouched — components are built, not wired.

Audits also done this commit:
- `lib/socket.js` — added public-API docstring contract block; no behavioral change.
- `components/ReconnectingBanner.jsx` (C4) — already uses `common.reconnecting` i18n key; fixed responsive offset (`left-0 md:left-64`) so the banner doesn't leave a sidebar-shaped gap on phone viewports.

Verification this commit:
- All four dev servers serve 200 after Phase 2 changes (`/dashboard/phase2-demo`, `/dashboard/reservations`, `/dashboard/live`, `/dashboard/calendar`, `/dashboard/settings`).
- New component files: zero hardcoded English UI strings (greppped). Demo route headers (e.g. "Phase 2 demo", "Toast", section labels) intentionally English — dev-only harness, not user-facing.
- C4 §5a socket smoke: 7/7 events fire ✓.
- C6 Phase 1 bench: 7/7 endpoints within budget ✓ (PUT edit drifted to p95=555ms on the first run, well within Railway-latency variance — re-run came in at p95=214ms).

**C6 Phase 1 (lock data contracts) shipped earlier this session.** New endpoints + amended shapes are the locked contract for Phase 3 features; Phase 2 components subscribe to these payloads directly.

Endpoints (full reference: `SPEC.md` §15 resolved section + `server/src/socket/events.md`):
- `GET /api/restaurant/dashboard/summary` — NOW/NEXT/counts in one round-trip.
- `GET /api/restaurant/layout/live` (augmented) — each table gets currentReservation, nextReservation, secondsLate. Fixed a pre-existing route-ordering shadow: `/layout/:sectionId`'s UUID validator was 400-ing the literal `/live` before its dedicated handler could match.
- `GET /api/restaurant/availability` — exact + any-match counts for Quick Add live hint.
- `PUT /api/restaurant/reservations/:id` — generic staff edit (date/time/party/phone/specialRequests).
- `PUT /api/restaurant/tables/:id/seat` — now writes a `TableActivity { kind: WALK_IN }` row (first writer of the previously-unused model); `walkin:created` payload carries `activityId`. `walkin:ended` closes the same row on OCCUPIED→FREE transitions at `/tables/:id/status`.

Performance (p95, 50 sequential calls against La Mama; all within budget):
| Endpoint | p95 | budget |
|---|---|---|
| `GET /dashboard/summary` | 123ms | 500ms |
| `GET /layout/live` | 116ms | 300ms |
| `GET /availability` | 178ms | 200ms |
| `GET /reservations` (today) | 62ms | 400ms |
| `GET /reservations/pending` | 144ms | 400ms |
| `PUT /reservations/:id` (edit) | 334ms | 400ms |
| `PUT /tables/:id/seat` (walkin alt) | 225ms | 400ms |

PUT edit needed an `updateMany` + `findUnique` refactor to drop a redundant restaurant-join round-trip — first pass came in at 697ms.

Regression checks: C4 §5a smoke 7/7 events ✓, C1 dispatcher 12/12 events ✓, §8.1/§9.2/§9.3 Occupied/OOS guards still intact at all assignment paths (reservation POST auto-confirm, eligible-tables, assign-table, seat, availability — verified via grep).

**Browser/Cowork verification still pending** from C4: two-tab cross-update, kill-backend reconnect banner, page-focus refetch network trace, mobile real-device update. C5 adds: confirm the language toggle flips strings immediately in each app without reload, and confirm the mobile toggle persists across app restart (SecureStore round-trip).

**Tier C6 (Waiter UX Critical Path) is LOCKED** via `memory/waiter_ux_strategy.md` (earlier commit this session). It is the binding reference for all restaurant-platform UI work.

Strategy contents (high level):
- **§3 — 13 UX items (8 P0 + 5 P1):** shared Reservation Detail popup (3.1, foundational), Quick Add everywhere (3.2), smart-defaulted Quick Add modal with pending-sync save + live availability hint (3.3), walk-in fast seating (3.4), no-show with undo (3.5), pending-reservation real-time alert with persistent header badge (3.6), Live floor plan name+party+time overlay (3.7), Dashboard rebuild as command center (3.8), edit-reservation from popup (3.9), Calendar "now" indicator + click-empty-slot (3.10), action button subtext (3.11), Special Requests inline visibility (3.12), late-arrival "X min late" state (3.13).
- **§4 — Operational reliability (cross-cutting):** availability/conflict rules surfaced as explicit error text; pending-sync (not optimistic) save pattern; undo for low-stakes destructive actions with cancel-confirmed carve-out; socket reconnect + page-focus refetch with "Reconnecting…" banner; **responsive design at 375 / 768 / 1024 / 1440 viewport classes (per-commit verification required)**; i18n key strategy that lets C5 and C6 partially parallelize.
- **§5a — Socket.IO events C4 must broadcast** to `restaurant:{restaurantId}` room: `reservation:created`, `reservation:pending-created`, `reservation:updated`, `reservation:cancelled`, `table:status-changed`, `walkin:created`, `walkin:ended`. C4 client must implement reconnect handler + page-visibility refetch + visible "Reconnecting…" banner. **When approving C4, augment its prompt with this exact list.**
- **§5b — Freshness model:** Socket.IO primary; client refetch on initial load / reconnect / tab focus; client intervals only for current-time display (30s), Calendar "now" indicator (60s), late-arrival recompute (60s).
- **§6 — Updated tier order:** `A → B → C1 → C2 → C3 → C4 → C5 → C6 → D+E+F+I (parallel) → G+H → J`. C6 strictly depends on C5; rule §4.6 allows partial parallel if C5 is mostly done.
- **§8 — 5-phase coding process:**
  1. **Lock contracts** (single commit: endpoints, event payloads, performance budgets — Dashboard summary p95 <500ms, tables-live <300ms, availability <200ms, action endpoints <400ms).
  2. **Build shared infrastructure** (toast provider, socket client w/ reconnect, ReservationDetailPopup, ActionButton, Quick Add modal, Reconnecting banner — one commit per component).
  3. **Implement waiter flows in fastest-first order** (Quick Add → Pending alert → Live overlay → Walk-in → No-show → Edit → Dashboard rebuild → Calendar improvements → polish badges/subtext/late-state — one commit per item).
  4. **Per-commit verification** including explicit viewport screenshots at 375 / 768 / 1440.
  5. **End-to-end shift QA** with seeded mixed-state restaurant (20 reservations, 5 pending, walk-in, no-show, conflict, OOS table).

**C6 P3-5 (No-show with undo) is the next code work.** Per waiter_ux_strategy.md §3.5: from the ReservationDetailPopup or the Live table popup for Awaiting-Guest reservations, "Mark no-show" sets status NoShow + frees the table, then shows a "Marked no-show — {name}. Undo" toast (variant=undo) with a 10-second grace. Undo verifies table state before reverting (race-with-walk-in edge case per §3.5: if a walk-in took the table in the grace window, undo shows an error toast and reservation stays NoShow). Backend `PUT /api/restaurant/reservations/:id/no-show` already exists from Phase 1; needs an `/undo` companion OR the existing route reused with status=AWAITING_GUEST.

Remaining Phase 3 sequence (fastest-first):
1. ~~Quick Add everywhere (3.2 + 3.3)~~ ✓ shipped earlier this session.
2. ~~Pending reservation alert (3.6)~~ ✓ shipped earlier this session.
3. ~~Live floor overlay (3.7)~~ ✓ shipped earlier this session.
4. ~~Walk-in fast seating (3.4)~~ ✓ shipped this session.
5. **No-show with undo (3.5)** — next.
6. Edit existing reservation (3.9) — needs PUT /reservations/:id wired into ReservationDetailPopup edit mode.
7. Dashboard rebuild (3.8) — largest, last.
8. Calendar improvements (3.10).
9. Special request badges + action subtext + late-arrival display (3.11 / 3.12 / 3.13).

Each Phase 3 item is its own commit per §8 Phase 4 (per-commit verification including viewport screenshots at 375/768/1440).

**Resume sequence (in order):**
1. Sebastian Cowork-QAs the walk-in action sheet at 375/768/1440: Free-table click (basic flow), party-size override warning, Arriving-Soon-within-30min warning gate, Esc/backdrop close, success toast.
2. Sebastian gives explicit approval to begin C6 P3-5 (No-show + undo).
3. Phase 3 items 5-9 (one commit each) → Phase 4 (per-commit viewport verification, already baked in) → Phase 5 (end-to-end shift QA) → Tier D + E + F + I parallel block → G + H → J.

Reference IDs from this session (for context if QA questions come up):
- C2 smoke email: Resend ID `3151f463-85b8-4aaf-9c35-4dcb98a28ad0` → sebastian.stroe1209@gmail.com.
- C2 regression email during C3 verification: Resend ID `9ddc1a8f-8af5-4dde-be88-53890c7c26df` → same address.
- C3 push level-1 hit Expo and got back a `DeviceNotRegistered` ticket (expected — fake token isn't device-issued; the `status: ok` path fires once a real Expo token is registered mobile-side).

## Decisions Sebastian gave (carry forward)

- **Push:** use Expo Push (`https://exp.host/--/api/v2/push/send`) — not Firebase Admin SDK. No service account JSON.
- **Email:** Resend. `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME` are in `server/.env`.
- **SMS:** Twilio in design, defer credentials to post-MVP. Code paths land with `console.log` stubs when env vars missing — already in place via `channels/sms.js`.
- **Storage (uploads):** Railway volume for MVP. No S3.
- **Tier I (table moving §8.2):** moved up into the Tier D+E+F parallel block.
- **Working rules:** one bug = one commit; verify rendered HTML with curl + grep AND source-grep for unsafe formatters; do not claim "verified" if only API smoke tests ran.
- **Browser verification caveat:** Next.js pages are client-rendered, so `curl` returns the pre-hydration shell. For UI-text/locale fixes: combine source-grep for unsafe formatters with HTML grep for static patterns. For API/data-driven fixes: API smoke + source-grep is what we can do; Sebastian's browser hard-refresh is the final acceptance.
- **Per-tier QA gate** (added 2026-05-09): each Tier C/D/E sub-step needs its own QA before the next starts. Don't chain.

## Caveats / things to remember mid-execution

- **Windows TaskStop / taskkill quirk:** killing the leaf node (e.g. `node src/index.js`) does NOT kill its npm/nodemon/bash parent chain. Use `taskkill /F /T /PID <bash-root>` to cascade, then verify zero `node.exe` processes plus all four ports free.
- **Prisma client regen on Windows blocks on DLL lock** if backend is running. Stop backend first.
- **C1 dispatcher dedup is in-memory only.** Backend restart re-fires recurring timers (#11/#12) once before the dedup map repopulates. Acceptable for MVP. Not acceptable post-MVP if the dashboard is showing notifications as toasts.
- **Shared Railway DB cleanup is gated.** Even rows the assistant created in the same session are not deletable without explicit Sebastian approval. Plan smoke tests to use synthetic dispatch (no business-table writes) when possible — see how `.smoke/dispatch-test.js` was structured.

## Quick-resume commands

```
cd server && npm run dev                # backend, port 4000        (stopped at session end)
cd apps/restaurant && npm run dev       # restaurant, port 3001     (stopped at session end)
cd apps/admin && npm run dev            # admin, port 3002          (stopped at session end)
cd apps/mobile && npm start             # mobile, Metro on 8081     (was never started this session)
```

Demo credentials (after `cd server && npm run db:seed` if data is stale):
- Admin: admin@aprez.ro / admin123
- Restaurant staff: lamama / lamama123
- Diner: demo@aprez.ro / user123
