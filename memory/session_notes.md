---
name: Session notes — handoff
description: Where we left off; what's pending; quick-resume commands. Update or delete after the next session picks up.
type: project
---

**Last session: 2026-05-16. Tier C6 Phase 2 (shared infrastructure) COMPLETE — ToastProvider/Toast/useToast, ActionButton (with subtext), ReservationDetailPopup (full §3.1 state-action matrix + socket-driven re-render), QuickAddReservation (smart defaults + live availability hint + pending-sync save + closed-hours warning), responsive at 375/768/1440. All mounted on `/dashboard/phase2-demo` for QA. C4 socket-lib + ReconnectingBanner audited (contract docstring added; banner now responsive at <768px). Real pages unchanged. C1/C4/C6-Phase1 regressions pass. Phase 3 (per-flow wiring, fastest-first order) is the next code work, gated on Sebastian's approval after he Cowork-QAs the demo route.**

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

## What's pending — Phase 2 complete; Phase 3 (per-flow wiring) is next, gated on Sebastian's approval

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

**C6 Phase 3 (per-flow wiring) is the next code work.** Awaiting Sebastian's explicit approval after he Cowork-QAs the `/dashboard/phase2-demo` route across 375/768/1440 viewports. Per waiter_ux_strategy.md §8 Phase 3, sequence is fastest-first:
1. Quick Add everywhere (3.2 + 3.3) — mount QuickAdd trigger globally, QuickAdd modal already built.
2. Pending reservation alert (3.6).
3. Live floor overlay (3.7) — needs frontend migration from /layout to /layout/live.
4. Walk-in fast seating (3.4).
5. No-show with undo (3.5) — needs PUT /no-show wired + ToastProvider undo path.
6. Edit existing reservation (3.9) — needs PUT /reservations/:id wired into ReservationDetailPopup edit mode.
7. Dashboard rebuild (3.8) — largest, last.
8. Calendar improvements (3.10).
9. Special request badges + action subtext + late-arrival display (3.11 / 3.12 / 3.13).

Each Phase 3 item is its own commit per §8 Phase 4 (per-commit verification including viewport screenshots at 375/768/1440).

**Resume sequence (in order):**
1. Sebastian Cowork-QAs `/dashboard/phase2-demo` at all three viewports.
2. Sebastian gives explicit approval to begin C6 Phase 3, item 1 (Quick Add everywhere).
3. Phase 3 items 1-9 (one commit each) → Phase 4 (per-commit viewport verification, already baked in) → Phase 5 (end-to-end shift QA) → Tier D + E + F + I parallel block → G + H → J.

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
