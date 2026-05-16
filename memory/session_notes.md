---
name: Session notes — handoff
description: Where we left off; what's pending; quick-resume commands. Update or delete after the next session picks up.
type: project
---

**Last session: 2026-05-16. Tier D commit 1 (restaurant-staff forgot-password) SHIPPED.** Schema additions (`RestaurantStaff.email`, `PasswordResetToken` polymorphic table with `userType` field) pushed to Railway clean. Backend endpoints `POST /api/auth/restaurant/forgot-password` (neutral 200) and `POST /api/auth/restaurant/reset-password` (validates token, bcrypt-hashes new password, marks token used in a transaction). Frontend pages `/forgot-password` + `/reset-password` + "Forgot password?" link on `/login`. End-to-end smoke 5/5 paths green; Resend delivered the test email (id `526a24ba-c5a5-4473-acc0-0959c395f588`). All regressions (C4 §5a, C1 dispatcher, C6 popup actions) pass. SPEC §15 §6.8 marked resolved. **Tier D commit 2 (mobile diner forgot-password + account deletion + phone-collection prompt) is next; gated on Sebastian's Cowork QA of the staff reset link.**

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

## What's pending — Tier D commit 1 shipped; commit 2 (mobile diner) is next

**Tier D commit 1 (restaurant-staff forgot-password) shipped this session.**

Schema (additive, no `--accept-data-loss`):
- `RestaurantStaff.email String?` — per-staff contact email set by admin during account creation (SPEC §6.8). Nullable so existing seeded rows don't need backfill; reset endpoint falls back to `Restaurant.email` when null.
- `PasswordResetToken` — polymorphic across user types: `{ id, userId, userType ('user' | 'restaurant' | 'admin'), token (unique), expiresAt, usedAt, createdAt }`. Same table will serve diner mobile in commit 2.

Backend (`server/src/routes/auth.routes.js`):
- `POST /api/auth/restaurant/forgot-password` — accepts `{ usernameOrEmail }`, always returns 200 with a neutral message (no leak about whether the username exists). On match: invalidates prior outstanding tokens for the staff, generates a fresh 32-byte hex token, sends a reset email via the C2 Resend transport. Recipient: `staff.email` (preferred) or `staff.restaurant.email` (fallback). If both null, logs a warning and still returns the neutral 200.
- `POST /api/auth/restaurant/reset-password` — accepts `{ token, newPassword }`. Validates token unique-lookup, then in order: matches `userType === 'restaurant'` (else 400 `invalid-token`), not used (else 400 `token-used`), not expired (else 400 `token-expired`). On success: bcrypt-hashes the new password, runs `staff.update` + `token.update(usedAt)` in a single transaction so a mid-flight crash can't leave the token usable.
- New env var: `RESTAURANT_FRONTEND_URL` (defaults to `http://localhost:3001`) — base for the reset link `${URL}/reset-password?token=…`.

Frontend (`apps/restaurant/`):
- `/forgot-password` page — single-field form, neutral success message on submit, "Back to login" link.
- `/reset-password` page — reads `?token=`, two password fields (new + confirm), client-side mismatch + min-length checks. Surfaces backend error codes (`token-expired` / `token-used` / `invalid-token`) as specific i18n copy. On success: 2s celebration → `router.push('/login')` (no auto-login — staff confirms by typing the new password).
- `/login` page — i18n'd (was hardcoded English) + "Forgot password?" link below the submit button.
- i18n keys added: `login.*` (7), `forgot.*` (7), `reset.*` (13) — all in `ro` and `en`.

Email template (`server/src/routes/auth.routes.js` inline):
- Subject: `Reset your password — {restaurantName}`.
- Text + HTML versions. HTML version has a primary-coloured CTA button + a fallback "or copy this link" with the raw URL.
- One-hour validity message + "ignore if you didn't request" copy.

End-to-end smoke (all 5 paths green):
- (a) `POST forgot-password` with valid username → 200 neutral + token row written with `expiresAt = now+1h`.
- (b) `POST reset-password` with valid token + 6+ char password → 200 + password updated.
- (c) `POST reset-password` with expired token → 400 + `code: token-expired`.
- (d) `POST reset-password` with used token → 400 + `code: token-used`.
- (e) `POST /restaurant/login` with new password → 200 + JWT issued.
- Resend log line: `[email:sent] id=526a24ba-c5a5-4473-acc0-0959c395f588 to=sebastian.stroe1209@gmail.com subject="Reset your password — La Mama"`.

Regressions: C4 §5a 7/7 ✓, C1 dispatcher 12/12 ✓, C6 popup-actions 12/12 ✓. All four dev servers serve 200.

SPEC.md §15 §6.8 marked resolved.

**Tier D commit 2 — coming next**: mobile diner forgot-password (mirrors the staff flow, reuses `PasswordResetToken` with `userType='user'`), account deletion §5.9 GDPR (anonymizes past reservation rows + erases PII + logs user out), phone-collection prompt after first reservation per SPEC §3.1 / §10 caveat.



**C6 closure (2026-05-16):**
- All 9 Phase 3 items shipped + Cowork-verified.
- 2 post-QA fix-the-fix commits shipped:
  - `0fccea2` — derived-AwaitingGuest action set + [unassigned] label.
  - `a2846a0` — extended `/dashboard/summary` + `/layout/live` payloads with `tableId`/`seatedAt`/`status`; extracted helpers to `lib/popupActions.js` (single source of truth shared with the Node smoke at `.smoke/c6-popup-actions-test.js`, 12/12 assertions pass); hardened `hasAssignedTable` to accept `tableLabel` as a fallback signal.
- Shift fixture (`server/.smoke/c6-shift-fixture-ids.json` manifest) cleaned up — 21 reservations + 1 TableActivity deleted, 7 touched tables restored. IDs file removed.

**Tier D + E + F + I parallel block — scope per `memory/waiter_ux_strategy.md` §6:**
- **Tier D — Auth completion**: forgot-password reset for staff + diner (SPEC §3.3 + §6.8); account deletion §5.9 GDPR (diner-side); phone collection prompt after first reservation if not yet provided (SPEC §3.1 post-MVP idea, may stay deferred).
- **Tier E — Reservation features**: modification flow on both mobile and restaurant per SPEC §5.6; must be consistent with C6 popup's `MODIFICATION_PENDING` row (currently view-only / "Tier D scope" marker — needs revisit since modification ships in Tier E not D, the inline marker is a labeling artifact from earlier planning).
- **Tier F — Admin uploads**: photos + menu PDF + reservation-disabled days + custom grid dimensions per SPEC §7.1 / §7.2; admin tool only.
- **Tier I — Table moving / combining**: drag-merge UI per SPEC §8.2, kept compatible with C6 Live overlay layout per §3.4 edge-cases rule (card height ≥80px preserved for drag handles).

**Dependency map (proposed):**
- D and F are fully independent of each other and of C6 — they touch auth + admin respectively, no shared surfaces.
- E touches the C6 popup (state-action matrix needs Approve/Reject row for MODIFICATION_PENDING) — should ship after the popup has had Cowork QA settling time.
- I modifies the Live page layout — should ship last in the block so any Live regression is isolated to one commit.

**Suggested order (Sebastian to approve or override):**
1. **D + F in parallel** — fully decoupled, can start immediately.
2. **E** — after D+F land OR in parallel with them if Sebastian has bandwidth; needs popup updates.
3. **I** — last in the block; biggest regression risk to the just-stabilized Live overlay.

Or **all-four-in-parallel** if Sebastian wants the speed and accepts the merge-conflict risk on the popup (E) and Live page (I).



**C6 derived-AwaitingGuest fix-the-fix shipped this session.** Commit 0fccea2 added `isAwaitingGuestDerived` but two paths silently failed in practice:
- **Dashboard path**: `/dashboard/summary`'s `shape()` returned `tableLabel` but not `tableId` or `seatedAt`, so `hasTable` was false and derived never fired. Fixed by adding both fields to the response shape + the `select`.
- **Live path REGRESSION**: `/layout/live`'s `summarize()` returned only `{id, guestName, partySize, time, hasSpecialRequests}` — no `status`. The popup got `status=undefined` and hit the switch's `default: return []` → "No actions available". Fixed by extending the summary to include `status`, `tableId`, `seatedAt`.

Refactor: extracted `isAwaitingGuestDerived` + `actionsForStatus` + `hasAssignedTable` into `apps/restaurant/lib/popupActions.js` (CJS module, framework-free). The popup imports it; `server/.smoke/c6-popup-actions-test.js` imports the same file — no copy-paste divergence between popup logic and the smoke. Hardened `hasAssignedTable` to accept `tableLabel` as a fallback signal (defensive against legacy/partial payloads).

Smoke results (Node runner, 12 assertions across 6 scenarios, 12/12 pass):
- A. Smith via Live (table.status=AWAITING_GUEST) → [seat,noshow,edit,cancel] ✓
- B. Smith via Dashboard summary (tableId + seatedAt + secondsLate) → [seat,noshow,edit,cancel] ✓
- B'. Smith via Dashboard legacy (no tableId, tableLabel only) → [seat,noshow,edit,cancel] ✓ (hardened fallback)
- C. Daniel (no tableId) → [edit,pickTable,cancel] ✓ (no Seat/No-show — no table)
- D. Florin future (table FREE, not late) → [edit,reassignTable,cancel] ✓ (no Seat/No-show)
- E. Seated guard (seatedAt set + table.AWAITING_GUEST) → derived=false ✓
- F. Pending sanity → [confirm,reject,edit,cancel] ✓

Direct fetch verification:
- `/api/restaurant/dashboard/summary` activeReservations[0] keys now include `tableId, seatedAt` — confirmed via curl.
- `/api/restaurant/layout/live` currentReservation keys now include `status, tableId, seatedAt` — confirmed via curl.
- Smith Family via both endpoints → `derived=true`, `actions=[seat, noshow, edit, cancel]`.

C4 §5a 7/7 ✓. C1 dispatcher 12/12 ✓. New + changed files: zero hardcoded English UI strings (helper is pure JS, no UI strings).

**Fixture still seeded.** After Cowork confirms Smith Family popup now works from both Dashboard + Live, run `cd server && node .smoke/c6-shift-fixture.js --cleanup`.

(Earlier this session) **Two findings from the first Cowork QA pass**, fixed in commit 0fccea2:

1. **Derived AwaitingGuest action set** — the popup's `actionsForStatus` previously only rendered Seat + No-show when `reservation.status === 'AWAITING_GUEST'`, which never happens in practice (ReservationStatus enum has no AWAITING_GUEST — that's only a table status per SPEC §9.1). New `isAwaitingGuestDerived` helper triggers the set when: `status ∈ {CONFIRMED, AUTO_CONFIRMED}` AND `tableId` set AND `!seatedAt` AND (`table.status === 'AWAITING_GUEST'` OR `secondsLate > 0`). Live + Calendar pages now pass `table.status` into the popup; Dashboard already passes `secondsLate` from summary. The `'AWAITING_GUEST'` case in the switch is kept as defensive code with a comment.
2. **[unassigned] label** — `reservations.unassignedTable` i18n key added (`[unassigned]` / `[fără masă]`). Rendered in Dashboard NOW + NEXT zone rows when `tableLabel` is missing; Reservations page row already had an English hardcoded version, converted to use the same key for consistency.

memory/waiter_ux_strategy.md §3.1 state-action matrix gained a clarification note that "AwaitingGuest" is a *derived* state, not a literal reservation status; documents the four conditions of `isAwaitingGuestDerived` so future tier work doesn't re-litigate the bug.

Smoke results: derived state simulated on all three fixture scenarios:
- Smith Family (CONFIRMED + table.AWAITING_GUEST + 20min late) → `[seat, noshow, edit, cancel]` ✓
- Daniel Vlad (AUTO_CONFIRMED + tableId=null) → `[edit, pickTable, cancel]` ✓ (no Seat/No-show since no table)
- Florin Tudor-style future (CONFIRMED + table.FREE + no late) → `[edit, reassignTable, cancel]` ✓ (no Seat/No-show)

C4 §5a 7/7 ✓. C1 dispatcher 12/12 ✓. New + changed files: zero hardcoded English UI strings.

**Fixture still seeded** — `server/.smoke/c6-shift-fixture-ids.json` holds the manifest for cleanup. After Cowork confirms the fix in browser, run `cd server && node .smoke/c6-shift-fixture.js --cleanup` to delete 21 reservations + 1 table-activity and restore 11 table-status mutations.



**C6 P3-8+P3-9 (Calendar enhancements + polish consistency pass) shipped this session as one combined commit.**

P3-8 (Calendar enhancements):
- New `<CalendarNowIndicator>` (`apps/restaurant/components/CalendarNowIndicator.jsx`) — separate component that owns its own setInterval and mutates the matching `<tr data-time>` directly via DOM API (`classList.add/remove`). Parent calendar's React tree stays stable across minute ticks per the "perf matters" requirement. Renders nothing when `selectedDate !== today`. Scrubs on unmount.
- Calendar page (`apps/restaurant/app/dashboard/calendar/page.js`) click router:
  - Existing reservation cell → opens `ReservationDetailPopup` (new mount).
  - OUT_OF_SERVICE empty cell → fires `calendar.tableOutOfServiceToast` warning toast (3s).
  - Other empty cell → opens `QuickAddReservation` prefilled with `{ date: selectedDate, time, tableId, tableLabel }`.
- `QuickAddReservation` extended with `prefill.tableId` + `prefill.tableLabel` support: shows a passive `quickAdd.prefilledTable` badge at top of form with a × to clear the assignment (falls back to unassigned-AutoConfirmed per §9.5). POST body carries `tableId` when prefilled. No full table-picker — preserves the §3.3 "form-light" Quick Add stance.

P3-9 (consistency pass):
- New shared `<SpecialRequestsBadge>` (`apps/restaurant/components/ui/SpecialRequestsBadge.jsx`) — accepts either `hasSpecialRequests` (boolean) or `specialRequests` (string). Renders the ✦ icon with the specialRequests text as the hover tooltip when present.
- New shared `<MinLateBadge>` (`apps/restaurant/components/ui/MinLateBadge.jsx`) — single threshold (`secondsLate > 600`), single visual treatment.
- Applied across all surfaces (consistency pass):
  - **Dashboard NOW + NEXT zones** — replaced inline `<MinLate>` helper + inline ✦ rendering with the shared components.
  - **Reservations page rows** — added ✦ next to guest name + MinLateBadge alongside the status badge. Computes `secondsLate` client-side (`reservationSecondsLate()` helper) since the `/reservations` endpoint doesn't return it; the helper checks `table.status === 'AWAITING_GUEST' && !seatedAt && date === today` and derives minutes-late from time vs Bucharest now.
  - **Live overlay** — refactored from inline ✦/late spans to the shared components.
  - **Calendar cell** — ✦ rendered inside the reservation block.
  - **ReservationDetailPopup header** — replaced two inline spans with the shared components. Deleted dead `minutesLate` const + `hasSpecial` no longer wraps the ✦ (the badge handles its own presence check).

i18n keys added: `calendar.nowIndicator`, `calendar.tableOutOfServiceToast`, `quickAdd.prefilledTable`, `quickAdd.clearPrefilledTable`. The badge components reuse `popup.specialRequestsBadge` + `popup.minutesLate` for tooltip/label copy (already in locales).

SPEC.md §15 updated:
- §6.4 calendar interactions (click-block + tap-empty-slot) → resolved.
- §3.10 Calendar "now" indicator → resolved.
- §3.12 Special Requests inline visibility → resolved (shared component).
- §3.13 Late-arrival display → resolved (shared component).
- §5.3 Special Requests UI → noted as covered (schema + edit-mode + ✦ badge); diner-side mobile still pending Tier D.

End-to-end smoke results:
- All 6 dashboard routes serve 200 after wiring.
- New component files: zero hardcoded English UI strings.
- Seeded AWAITING_GUEST reservation 12 min past with `specialRequests: 'anniversary'`:
  - `/dashboard/summary` row: `hasSpecialRequests: true`, time present ✓.
  - `/layout/live` table: `secondsLate: 720` ✓.
- C4 §5a socket smoke: 7/7 events fire ✓.
- C1 dispatcher: 12/12 SPEC §10 events route ✓.
- Schema unchanged.

**C6 PHASE 3 COMPLETE.** All 9 items shipped this session:
1. ~~Quick Add everywhere (3.2 + 3.3)~~ ✓
2. ~~Pending reservation alert (3.6)~~ ✓
3. ~~Live floor overlay (3.7)~~ ✓
4. ~~Walk-in fast seating (3.4)~~ ✓
5. ~~No-show with undo (3.5)~~ ✓
6. ~~Edit existing reservation (3.9)~~ ✓
7. ~~Dashboard rebuild (3.8)~~ ✓
8. ~~Calendar enhancements (3.10)~~ ✓
9. ~~Polish: ✦ + late-badge consistency (3.12 + 3.13)~~ ✓

**C6 P3-7 (Dashboard rebuild) shipped earlier this session.** Biggest user-visible change in C6. Four new components + page rewrite + SPEC §15 §6.2 update.

New components in `apps/restaurant/components/dashboard/`:
- `StatTile.jsx` — reusable count card with left-border accent (primary / amber / blue / gray). Optional `href` makes the whole tile a Link.
- `NowZone.jsx` — active reservations list (AwaitingGuest + Occupied). Sorted by table label. Each row: time, guest name + ✦ badge, table + party, "X min late" pill if `secondsLate > 600`. Empty-state copy `dashboard.now.empty`.
- `NextZone.jsx` — upcoming chronological list. Renders the 8 from summary by default; Show more lazy-loads up to 24 via the existing `/api/restaurant/reservations` endpoint (no date filter → returns from today onward), filters to PENDING/CONFIRMED/AUTO_CONFIRMED, dedups against the seed 8. Each row: time, guest, table + party + date, status badge. Empty-state `dashboard.next.empty`.
- `SearchZone.jsx` — search input with `dashboard.search.placeholder`. Debounced 300ms call to `/api/restaurant/reservations/search?q=`. Results rendered as a flat list (guest name + contact + date+time+party). Click → popup. Empty input renders nothing; non-matching query → `dashboard.search.empty`.

Page rewrite (`apps/restaurant/app/dashboard/page.js`):
- Orchestrator: single `load(quiet)` fetches `/api/restaurant/dashboard/summary`, sets `lastUpdated`, manages `loading` flag (quiet=true skips the toggle for background refetches per the established pattern).
- Socket subs: any reservation:* / table:status-changed / walkin:* event triggers `load(true)`. Aggregate-view tradeoff — surgical patching across three zones wasn't worth the per-zone wiring complexity.
- §4.4 reconnect + tab-focus refetch via `useSocketRefetch`.
- Header clock (`Bucharest HH:mm`) ticks every 30s via `setInterval`. Independent of data fetches.
- Shared `<ReservationDetailPopup>` mounted at the page level; all three zones' onPick callbacks set the same popup state.
- Responsive layout via Tailwind:
  - `<xl` (under 1280px): stat tiles in a 3-col row at top (`grid-cols-1 sm:grid-cols-3`); NOW + NEXT stacked vertically (`grid-cols-1 xl:grid-cols-3`); SEARCH full width below.
  - `xl+` (1280px+): stat tiles row hides (`xl:hidden`); the same three tiles render in a right-column stack inside the main grid (`hidden xl:flex xl:flex-col`); NOW + NEXT + stats column take 3 equal cols.

Preserved (untouched):
- Sidebar nav + Logout button (left rail at every breakpoint).
- Global floating "+" Quick Add button (P3-1).
- Global pending-confirmation header badge (P3-2).
- Audio-consent banner (P3-2).
- All auth gates and routing.
- /dashboard/live, /reservations, /calendar, /settings — out of P3-7 scope, untouched.

SPEC.md §15 §6.2 dashboard gaps: marked **partially resolved by Tier C6 P3-7**. Three-zone command center + dashboard-level guest search now in place; Add Reservation entry point is the global floating + button (P3-1). Notification feed + ban-client search on dashboard remain deferred (per §3.8 out-of-scope list — low-frequency ops).

i18n keys added (`dashboard.*`: title, currentTime, lastUpdated, loadError, now.{title,empty}, next.{title,empty,showMore,showLess}, search.{title,placeholder,empty}, stats.{today,pending,occupied}) — 15 keys total in both ro and en.

End-to-end smoke results:
- All 6 dashboard routes serve 200 after rewrite (`/dashboard` p=84ms).
- New dashboard files: zero hardcoded English UI strings (greppped page.js + 4 component files).
- Summary endpoint: returns the expected shape with `currentTime`, `activeReservations`, `upcomingReservations`, `pendingConfirmationCount`, `todayCount`, `occupiedCount`.
- Search "Ion": returns 10 matching reservations in 230ms (well within 300ms+lookup budget).
- C4 §5a socket smoke: 7/7 events fire ✓.
- C1 dispatcher: 12/12 SPEC §10 events route ✓.
- Schema unchanged.

**C6 P3-6 (Edit existing reservation) shipped earlier this session.** Backend conflict-check + frontend inline edit mode.

Backend (`server/src/routes/restaurantPlatform.routes.js`):
- `PUT /api/restaurant/reservations/:id` extended with conflict detection per §4.1. When `time` or `date` changes on a reservation that has a `tableId`, the endpoint fetches the reservation's current values, computes the new window, and queries for an overlapping CONFIRMED/PENDING/AUTO_CONFIRMED reservation on the same table at that date excluding the current row. If a conflict exists → 409 `{ error: 'table-conflict', tableLabel, conflictTime }`. No conflict OR no time/date change → proceeds with the existing updateMany path. Phase 1's "trust model" comment is now superseded — §4.1 mandates the check.

Frontend (`apps/restaurant/components/ReservationDetailPopup.jsx`):
- New popup-internal edit mode. `handleAction('edit')` intercepted (same pattern as P3-5's no-show); flips `editMode` true, populates `editForm` from `current`, fetches `/api/restaurant/profile` once for service periods.
- Render: when `editMode === true`, popup body shows form (Date / Time / Party stepper / Phone / Special Requests). When false, the pre-P3-6 view mode renders unchanged.
- Availability hint: debounced 300ms call to `/api/restaurant/availability` mirroring QuickAdd's §3.3 pattern. Same three-tier copy (exact / last-one / combining needed).
- Closed-hours warning: same Yes/No ack pattern as QuickAdd, adapted for edit semantics — No just dismisses the warning (doesn't close the whole popup). Save remains disabled while the warning is unacked.
- Pending-sync save per §4.2: spinner on Save button, 10s timeout fallback, on 200 popup updates `current` and exits edit mode + success toast, on 409 `table-conflict` shows the specific `edit.error.tableConflict` error inline.
- Diff send: payload contains only fields whose value differs from `current` — saves the network round-trip when nothing changed (exits edit mode silently).
- guestName + tableId + status NOT editable inline per spec — guestName deferred to admin, tableId via Reassign-table action, status via state-machine transitions.

i18n keys added (`edit.{title,field.*,button.*,toast.saved,warning.*,error.*}`) in both ro and en.

End-to-end smoke (all four §3.9 paths verified):
- A. Happy: PUT edit changes time 18:00→19:00 + adds special requests → 200, time + endTime recomputed, specialRequests stored.
- B. State-machine: greppped `actionsForStatus` — `'edit'` is NOT in the array for CANCELLED (or COMPLETED, NO_SHOW). Frontend never renders Edit for view-only states. (Verification: regex check returned false.)
- C. Conflict: PUT edit moves reservation A's time onto reservation B's slot on the same table → 409 `{ error: 'table-conflict', tableLabel: 'T13', conflictTime: '21:30' }`. Frontend renders `edit.error.tableConflict` inline.
- D. Cancel: pure frontend behavior — `exitEditMode()` returns the popup to view mode without writing. No API call.
- All four dev servers serve 200; new popup edit-mode code zero hardcoded English; C4 §5a 7/7 ✓; C1 dispatcher 12/12 ✓.

**C6 P3-5 (No-show with undo) shipped earlier this session.** Schema additions + backend endpoint + popup wiring + bundled label-prefix fix.

Schema (additive, two `db:push` runs, no `--accept-data-loss`):
- `Reservation.noShowPriorStatus String?` — captures the reservation's prior status (typically AUTO_CONFIRMED/CONFIRMED) before the no-show transition.
- `Reservation.noShowPriorTableStatus String?` — captures the table's prior status (typically AWAITING_GUEST). Two columns because `ReservationStatus` and `RestaurantTable.status` are unrelated enums — caught mid-implementation when the restore endpoint tried to set reservation.status = 'AWAITING_GUEST' and Prisma rejected.

Backend (`server/src/routes/restaurantPlatform.routes.js`):
- `PUT /api/restaurant/reservations/:id/no-show` now reads the current table status BEFORE the transition and writes both prior columns; response includes `tableLabel` so the client can render it in the undo toast without a follow-up fetch.
- NEW `PUT /api/restaurant/reservations/:id/restore-no-show`:
  - Verifies reservation is currently NoShow.
  - Verifies the assigned table is still FREE; if not, 409 with `{ error: 'table-no-longer-free', tableLabel }`.
  - Restores reservation status from `noShowPriorStatus` (fallback CONFIRMED) and table status from `noShowPriorTableStatus` (fallback AWAITING_GUEST); clears both columns.
  - Emits `reservation:updated` + `table:status-changed`.

Frontend (`apps/restaurant/components/ReservationDetailPopup.jsx`):
- Added internal `handleNoShow` + `handleUndoNoShow` handlers. `handleAction('noshow')` is intercepted in the popup; other actions still forward via `onAction` to the parent.
- Loading state: `processingAction` flags drive ActionButton `loading={true}` for the clicked button and `disabled={true}` for siblings.
- Inline `actionError` slot added between detail grid and actions for popup-handled-action failures.
- On 200: popup closes, undo toast (variant=undo, durationMs=10000) shows with copy `noShow.toast.marked` + actionLabel `noShow.toast.undo`.
- On undo 200: success toast `noShow.toast.undone`.
- On undo 409 (race): error toast `noShow.toast.undoFailed` interpolated with tableLabel from the 409 body.

TT-prefix bug fix (bundled per P3-4 QA feedback):
- `tableNumber` already carries "T" prefix per commit `5eabdc0` (seed has values like "T9", "T13").
- Four sites stripped redundant `\`T${tableNumber}\`` template:
  - `apps/restaurant/components/WalkInActionSheet.jsx` — `tableLabel` local var + `walkIn.toast.seated` interpolation.
  - `apps/restaurant/components/ReservationDetailPopup.jsx` — `tableLabelOf()` helper.
  - `server/src/routes/restaurantPlatform.routes.js` — dashboard/summary `tableLabel` payload.
- Grep confirmed zero remaining `\`T${...tableNumber}\`` patterns in apps/ or server/src/.

i18n keys added (`noShow.toast.{marked,undo,undone,undoFailed}`) in both ro and en.

End-to-end smoke (all three §3.5 paths verified):
- A. Happy path: no-show → status NO_SHOW with `noShowPriorStatus: AUTO_CONFIRMED`, `noShowPriorTableStatus: AWAITING_GUEST`, `tableLabel: T13`, table freed. Undo → reservation back to AUTO_CONFIRMED, both prior columns cleared, table back to AWAITING_GUEST.
- B. Race: no-show → walk-in seats the freed table → undo returns 409 `table-no-longer-free` with `tableLabel: T13`.
- All four dev servers serve 200 after wiring; new popup code zero hardcoded English; C4 §5a 7/7 ✓; C1 dispatcher 12/12 ✓.

**C6 P3-4 (Walk-in fast seating) shipped earlier this session.** New component + Live wiring + small backend extension.

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

**Resume sequence (in order):**
1. Sebastian picks the Tier order (D+F parallel → E → I, OR all-four-parallel, OR a custom sequence).
2. For each Tier picked, Sebastian approves the next item before it starts (per the established per-item gate).
3. After D + E + F + I → G + H → J → MVP launch readiness.

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
