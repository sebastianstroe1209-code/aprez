---
name: Session notes — handoff
description: Where we left off; what's pending; quick-resume commands. Update or delete after the next session picks up.
type: project
---

**Last session: 2026-05-20. Tier J launch-fix 1a SHIPPED — diner special-requests field (§5.3). Commit `feat(mobile): J1a — diner special-requests input on BookReservationScreen + POST body field`, pushed to origin/main.**

- **The §5.3 gap the Tier-J spec walk surfaced:** the mobile booking flow never collected "Special requests" and `POST /api/reservations` never read the field — despite the `specialRequests` column existing since Tier B and the §15 entry being commented-out as if resolved. J1a closes it.
- **Mobile:** `BookReservationScreen.js` step 1 gains an optional multi-line "Special requests" `TextInput` (`maxLength` 500, `minHeight` 88, placed after the date scroller); `handleBook` sends `specialRequests: specialRequests.trim() || undefined` (blank → key omitted → backend stores null). 2 i18n keys (`book.specialRequestsLabel` / `book.specialRequestsPlaceholder`, RO + EN, new `book` namespace).
- **Backend:** `POST /api/reservations` extended — `body('specialRequests').optional({nullable:true}).isString().trim().isLength({max:500})` validation; the create `data` stores `trim()`-or-`null`; added `specialRequests` to the response `select`. (The J-walk found the route did NOT previously read the field — the task brief assumed it did.) The 500-char cap is a new diner-side limit; the staff popup `<textarea>` has no explicit cap.
- **Round-trip verified end-to-end:** diner POST with `specialRequests` → persisted row carries it → `GET /api/restaurant/reservations` (staff) returns it in the row shape → that's exactly what feeds the staff ✦ `SpecialRequestsBadge` + popup body field (C6 P3-9). New smoke `server/.smoke/j1a-special-requests-test.js` 13/13 (incl. empty→null, whitespace→null, 501-char→400).
- **Verified:** full 17-suite battery green (C1 12/12, C6 popup-actions 19/19, C6 live-grid 18/18, c6-assign-table-override-wiring 14/14, g-auto-confirm-picker 11/11, g-prune 5/5, g-restaurant-settings 26/26, g5b-restaurants-filter 32/32, h4-calendar-walkins 16/16, j1a-special-requests 13/13, smoke-tierd2/e1/e2/f1/f2/i1/i3 all OK). Android bundle clean (HTTP 200, 7.06 MB). No schema change.

**Tier J launch-readiness — J1b is next, awaits Sebastian's approval. J1b = mobile push-token registration (the launch blocker from the Tier-J spec walk):** add `expo-notifications` to the mobile app, request notification permission + obtain the Expo push token on login, POST it to the existing `PUT /api/users/me/push-token` endpoint, and wire the 45-min reminder's Yes/No notification-response actions. Server-side push (transport, dispatcher, reminder job) is already complete — only the mobile half is missing, so diners currently receive zero push. After J1b: decide SMS (stub → formally defer to v1.1 via a §14 decision, or wire Twilio).

---

**Earlier last session: 2026-05-20. Tier H commit 3 SHIPPED — palette token sweep. Commit `feat(theme): H3 — formalize status/action/feedback color tokens in the shared theme source-of-truth`, pushed to origin/main. ⭐ TIER H IS COMPLETE END-TO-END (H1 → H4 all shipped).**

- **`packages/shared/theme/colors.js`** gained **33 web tokens** (`tailwindColors`, consumed by both Next apps via `theme.extend.colors`) + **4 mobile tokens** (`Colors`): status-badge tints `status-{pending,confirmed,awaiting,occupied,cancelled,noshow,neutral,info}-bg/-fg` (16); alert-banner trios `alert-{error,success,warning}-bg/-border/-fg` (9); action-button fills `action-{danger,info,success,warning}` + `-hover` (8); mobile `warnTint`/`warnTintBorder`/`warnTintBorderSoft`/`warnTintText`. Existing `primary`/`table-*`/`res-*`/`error`/`warning`/`info`/`sidebar` tokens untouched (H3 EXTENDS, doesn't rebuild).
- **55 consumer usages migrated across 22 files** (subagent did the mechanical swap to an exact mapping; verified by grep): NextZone `STATUS_TONE` + Reservations `statusBadgeColor` maps + inline status chips → `status-*`; ~14 alert banners + 2 ReconnectingBanners → `alert-*`; `ActionButton` VARIANT_STYLES (reject/seat/complete) + ~15 inline solid buttons → `action-*`; 18 mobile inline hex → `Colors.*` (mobile now has zero raw 6-digit hex).
- **Visual:** token hex sampled 1:1 from the Tailwind classes replaced → colour-identical by construction. Two intentional shade-unifications: Reservations Reject/Seat buttons were `bg-red-500`/`bg-blue-500` (one shade lighter than ActionButton's 600 family) → now the shared `action-danger`/`action-info`; the Reservations COMPLETED badge text gray-800→gray-700 (shares `status-neutral-fg`).
- **Legitimately left raw** (Behavior-3 audit): the lighter `bg-red-50 border-red-300` small-alert variant (a 2nd error style, not the cluster-B `bg-red-100 border-red-400` banner); `Toast.jsx` variant map (own component, already centralized); Live `statusColors` floor-plan card tints (`bg-X-50` family + already on `border-table-*`); ActionButton `noshow`/`unmerge` tints + `cancel`/`edit`/`reassign` greys (single-use / structural neutral); `OverrideModal` + admin Generate-Credentials `bg-orange-600` (orange ≠ amber-600 `action-warning` — would shift hue); decorative `bg-blue-500`/`bg-amber-400` divider bars; text-link `text-red-600` delete actions.
- **Verified:** 7 restaurant+admin `/dashboard/*` pages serve 200; Android bundle clean (HTTP 200, 7.06 MB); full 16-suite battery green (C1 12/12, C6 popup-actions 19/19, C6 live-grid 18/18, c6-assign-table-override-wiring 14/14, g-auto-confirm-picker 11/11, g-prune 5/5, g-restaurant-settings 26/26, g5b-restaurants-filter 32/32, h4-calendar-walkins 16/16, smoke-tierd2/e1/e2/f1/f2/i1/i3 all OK). No schema / backend / test changes — theme + consumer rewrites only.

**Tier H is COMPLETE (H1 comment-strip → H2 Calendar service-period filter → H4 Calendar past+future view → H3 palette tokens). Next: Tier J launch QA — awaits Sebastian.** Tier J headline: the **real-device mobile pass** (no mobile surface device-walked since the G4 Metro-config fix — G4 maps, G5a/G5b home filters, E2 modification screens, F1 photo gallery, D2 GDPR/forgot-password all bundle-verified only) + a **final SPEC §1–§14 compliance sign-off**. Known v1.1 gap still open: Calendar OOS-history rendering (SPEC §15 Polish-deferred).

---

**Earlier last session: 2026-05-20. Tier H commit 4 SHIPPED — Calendar past+future view (§6.4 locked scope). Commit `feat(ui): H4 — Calendar past+future view with walk-in rendering, today→Live redirect, tomorrow default`, pushed to origin/main.**

- **Locked product scope:** Calendar is the past+future *planning* view; **today is owned by Live**. Three behaviors in `apps/restaurant/app/dashboard/calendar/page.js`: (1) **today→Live redirect** — date = today (Bucharest) → `router.replace('/dashboard/live')`, renders `null` in between (no grid flash); used `replace` not `push` to avoid a Back-button trap on Calendar-today. (2) **date-picker default = tomorrow** — `?date=` URL param still wins (shareable links / QuickAdd prefill). (3) **past dates render read-only walk-in segments** — amber fill spanning `[startedAt, endedAt]` in 15-min increments, label `{name} × {N}` / `Walk-in × {N}`; empty past cells inert (cursor `default`, no QuickAdd); reservation cells stay clickable (popup view-only — `popupActions` already returns `[]` for COMPLETED/NO_SHOW/CANCELLED, audited).
- **New backend endpoint** `GET /api/restaurant/walk-ins?date=YYYY-MM-DD` (restaurantPlatform.routes.js) — returns walk-in `TableActivity` rows for a PAST date, `[]` for today/future. JWT-scoped, not section-filtered (Calendar renders the active section client-side, like reservations). Payload per row: `{ id, tableId, partySize, startedAt, endedAt, walkInName }` (`walkInName` ← `TableActivity.notes`). **No schema change** — `TableActivity` + the `notes` walk-in-name convention already exist (C6 Phase 1 / P3-4).
- **OOS history NOT rendered** — logged as a v1.1 gap under SPEC §15 "Polish (deferred)" (`TableActivity` is only written for `WALK_IN`, never `OUT_OF_SERVICE`; OOS stays a real-time-only `RestaurantTable.status` signal).
- **i18n:** 2 new `calendar.*` keys (RO + EN) — `walkInNamed`, `walkInAnon`.
- **Verified:** new smoke `server/.smoke/h4-calendar-walkins-test.js` 16/16 (yesterday returns the seeded named+anon rows with correct shape; today + tomorrow return `[]`). Calendar page compiles + serves 200 for no-date / today / yesterday / future variants. Full 15-suite regression battery green (C1 12/12, C6 popup-actions 19/19, C6 live-grid 18/18, c6-assign-table-override-wiring 14/14, g-auto-confirm-picker 11/11, g-prune 5/5, g-restaurant-settings 26/26, g5b-restaurants-filter 32/32, smoke-tierd2/e1/e2/f1/f2/i1/i3 all OK). The redirect + walk-in visual rendering are client-side — need Sebastian's browser pass for final visual confirmation (Next pages serve only the pre-hydration shell to curl).

**Tier H commit 3 — SHIPPED (see the top of this file). Tier H complete.**

---

**Earlier last session: 2026-05-20. Tier H commit 2 SHIPPED — Calendar service-period filter mount. Commit `feat(ui): H2 — Calendar service-period filter mount + timeInPeriod helper extraction`, pushed to origin/main.**

- **`ServicePeriodFilter` mounted on the Calendar** (`apps/restaurant/app/dashboard/calendar/page.js`) as the 3rd control in the Controls row beside Date + Section. Calendar fetches `servicePeriods` once from `/api/restaurant/profile` (mirrors Live), holds `selectedPeriodId` ('' = "All periods", the default). With a period selected, a reservation's guest chip renders only when its start time is inside the period window — **visual-only filter**: `res` still drives cell-click routing so a period-hidden reservation can't be mistaken for a free slot (identical to Live's overlay-suppression).
- **`timeInPeriod()` extracted** from `live/page.js` into the new shared `apps/restaurant/lib/servicePeriod.js`. Both Live and Calendar now import it — one source of truth (grep-confirmed: exactly one `function timeInPeriod` definition, two import sites). Same one-source precedent G5b set.
- **Verified:** `timeInPeriod` single-source grep ✓; `/dashboard/calendar` + `/dashboard/live` both render 200; full 15-suite regression battery green. No backend / schema / test changes — frontend-only.

---

**Earlier last session: 2026-05-20. Tier H commit 1 SHIPPED — comment/dead-route cleanup. Commit `chore: H1 — strip §15-marker tombstone comments + delete phase2-demo route`, pushed to origin/main.**

- **Stripped 4 "X removed — SPEC §Y" tombstone comment blocks** (kept through Tiers E/F/G as audit aids, now drained): Phone OTP §3.4 (`auth.routes.js`), Waitlist routes §6.6 (`restaurantPlatform.routes.js`), Analytics §7.4 + Billing §7.5 (`admin.routes.js`). Non-tombstone "moved to lib" pointer notes from G5b/G6 (e.g. the `computeMergeSuggestions` relocation note in restaurantPlatform.routes.js) were deliberately KEPT — not targets.
- **Deleted `apps/restaurant/app/dashboard/phase2-demo/page.js`** — the Tier C6 Phase-2 standalone-verify harness route, never linked from any sidebar/router. Confirmed zero incoming imports/links. Reworded the one stale code comment in `QuickAddReservation.jsx` that named the demo route, and the SPEC C6-Phase-2 narrative line that referenced it. (4 dated historical mentions of `phase2-demo` remain in this file's older C6-era handoff log — left intact as accurate history; rewriting past session records would be dishonest.)
- **bg-sidebar comment tidy** in `packages/shared/theme/colors.js` — clarified that `sidebar` IS the canonical token (the old comment's "no semantic equivalent" / "still use" wording wrongly implied a pending migration; Cluster D of the H audit is effectively closed).
- **Verified:** all 3 route `.js` files compile; restaurant + admin `/dashboard/*` build clean; mobile bundle clean. Pure-JS smokes green — C1 dispatcher 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18, c6-assign-table-override-wiring 14/14. No schema / backend-behavior / test changes — pure cleanup.

---

**Earlier last session: 2026-05-20. Tier G commit 7 SHIPPED — dropped two dead columns (`Reservation.fromWaitlist` + `User.fcmToken`). Commit `fix(db): G7 — drop dead columns Reservation.fromWaitlist + User.fcmToken`, pushed to origin/main. ⭐ TIER G IS COMPLETE END-TO-END (G1 → G7 all shipped).**

- **Schema migration** — both columns dropped in one `npx prisma db push --accept-data-loss` against Railway. `from_waitlist` drop carried the expected data-loss notice ("44 non-null values" — all the column's `false` default, no real signal; user explicitly approved). `fcm_token` drop was clean (all-NULL, no notice). "Database now in sync", 2.49s; Prisma Client v5.22.0 regenerated in 119ms. (An unrelated Prisma 5.22→7.8 version-update advisory printed — NOT a migration warning; left for a separate decision.)
- **Pre-flight grep** — full workspace scan (`server/`, `apps/`, `packages/`) for `fromWaitlist` / `fcmToken` / `from_waitlist` / `fcm_token`: **zero code readers**. Only hits were the two schema-field definitions themselves (removed this commit) + doc/comment references (`SPEC.md`, `session_notes.md`, untracked `STATUS_FOR_COWORK.md` + `archive/`).
- **Bundled doc fix:** the SPEC §10 push-notification pseudo-code still read `user.fcmToken` — corrected to `user.expoPushToken` (the live column since C3) in the same commit, so the spec doesn't reference a dropped column.
- **Verified:** backend killed cleanly (taskkill `/F /T` on the npm/nodemon tree, port 4000 freed before the migration to avoid the Windows Prisma-DLL lock) + restarted clean; `/api/health` 200; staff login (`lamama`) → 200 with token. **Full 15-suite regression battery green** against the live DB: C1 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18, c6-assign-table-override-wiring 14/14, g-auto-confirm-picker 11/11, g-prune 5/5, g-restaurant-settings 26/26, g5b-restaurants-filter 32/32, smoke-tierd2/e1/e2/f1/f2/i1/i3 all SMOKE OK.

Tier G (G1 housekeeping → G2 backend → G3 settings/uploads → G4 service-period filter + maps → G5a location filter → G5b party/date/time filter → G6 FK cascade fix → G7 dead-column drops) is fully shipped; §15 backlog's schema-cleanup items are all closed. After Tier H: **Tier J launch QA** (mobile real-device pass is the headline — no mobile surface has been device-walked since the Metro config was fixed in G4).

---

**Earlier last session: 2026-05-20. Tier G commit 6 SHIPPED — TableMove FK cascade fix (schema migration). Commit `fix(db): G6 — TableMove FK cascade fix (table → CASCADE, merged-with + reservation → SET NULL)`, pushed to origin/main.**

- **Schema migration applied to Railway** via `npx prisma db push --accept-data-loss` (clean — "Your database is now in sync", 2.33s; Prisma Client v5.22.0 regenerated in 165ms; zero warnings). `--accept-data-loss` was required only because Prisma classifies any FK redefinition as destructive — semantically the opposite: no columns dropped, no rows touched, just corrected cascade behavior. The three `table_moves` FKs were redefined: `table_moves_table_id_fkey` RESTRICT → **CASCADE**, `table_moves_merged_with_table_id_fkey` RESTRICT → **SET NULL**, `table_moves_reservation_id_fkey` RESTRICT → **SET NULL**. Root cause: pre-Tier-I no `TableMove` rows existed so the RESTRICT default never bit; once Tier I wrote real merge rows, the Tier F2 section-delete cascade FK-failed (`23001`) on tables with move history.
- **`server/scripts/cleanup-tieri-qa.js` removed** — the pre-purge workaround written during Tier I3 cleanup is now dead code (the F2 section-delete cascade "just works"). Source-grep confirmed zero callers / npm-script references (it was always a one-off manual script; only self-reference was its own usage comment).
- **Functional confirmation** (new smoke case `[j]` in `server/scripts/smoke-tierf2.js`, now 10 paths): seed a smoke section + table + a `TableMove` row tied to that table → `DELETE /api/admin/sections/:id` → **200**, with the section row, the table row, AND the `TableMove` row all cascade-deleted automatically — no manual pre-purge. Pre-G6 this exact shape FK-failed (`23001`).
- **Verified:** backend killed cleanly (taskkill `/F /T` on the npm/nodemon parent tree — port 4000 freed before the migration so the Prisma client regen didn't hit the Windows DLL lock) + restarted clean, `/api/health` 200. Regression all green: pure-JS C1 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18; DB suites g-auto-confirm-picker 11/11, g-prune 5/5, g-restaurant-settings 26/26, smoke-tieri1 (merge feasibility + lifecycle) SMOKE OK, smoke-tieri3 SMOKE OK, smoke-tierf2 (incl. new `[j]`) SMOKE OK.

**Tier G commit 7 — SHIPPED (see the top of this file). Tier G complete.**

---

**Earlier last session: 2026-05-20. Tier G commit 5b SHIPPED — party/date/time availability filter on the mobile home screen (§5.1). Commit `feat(mobile): G5b — party/date/time filters on HomeScreen with per-restaurant availability join`, pushed to origin/main.**

- **Backend `GET /api/restaurants` extension.** Three new optional query params — `partySize` (int 1–30), `date` (`YYYY-MM-DD`, today-or-future in Europe/Bucharest, via `Intl` `en-CA`), `time` (`HH:mm`, 15-min granular). **All-or-none:** the availability join engages ONLY when all three are present; any subset is ignored → unfiltered baseline (existing `search`/`cuisine`/`lat`/`lng` untouched and compose with the new params). Structured `{ error: { code } }` 400s: `invalid-party-size`, `invalid-date`, `date-in-past`, `invalid-time` — each param format-validated when present even if the filter doesn't engage.
- **Availability join** (`filterByAvailability` in `restaurant.routes.js`, runs after cuisine/search/banned, before the distance sort). A restaurant qualifies for the requested flat 120-min window if: open at that time (cross-midnight aware) + inside a service period if the day has any + not a disabled date + (a single free table seating ≥ partySize **OR** a feasible adjacent merge of free tables summing ≥ partySize). All per-restaurant lookups BATCHED — 5 queries total (openingHours / servicePeriods / disabledDates / tables / reservations), keyed back in memory. Biased to false positives: single-table check is `≥` not exact; stale-row races accepted (diner sees honest "no tables" on the actual booking POST).
- **Shared-helper extractions (one source of truth, zero drift):** `computeMergeSuggestions` moved `restaurantPlatform.routes.js` → `lib/tableMerges.js`, gained an optional `conflictSet` arg so the batched join skips its per-call reservation query (staff `/availability` caller unchanged — passes nothing, queries as before). `timeMinutesFitsOpenWindow` moved `reservation.routes.js` → new `lib/openingHours.js`, which also adds `timeWithinServicePeriods`. reservation.routes.js + restaurantPlatform.routes.js now import from the libs.
- **Mobile `HomeScreen.js`:** Party / Date / Time chips beside G5a's Nearby chip in the existing `locationRow`. Each opens a bottom-sheet picker modal — party stepper (1–30, default 2), month calendar grid (past-day gray-out, prev/next-month nav, Intl-localized month + weekday labels), 15-min time slots 08:00–23:45 (fixed range — home list carries no per-restaurant hours; default = next 30-min slot). All-or-none UX: unset chips get a primary-bordered hint style + a hint line until all three are set; then the GET fires and a result-count badge renders. Per-chip × clear + a master "Clear all" chip. Localized filter empty state.
- **i18n:** 14 new `homeFilters.*` keys (RO + EN) — `party.{label,title,stepperUp,stepperDown}`, `date.{label,title,today}`, `time.{label,title}`, `setButton`, `clearAll`, `allOrNoneHint`, `resultCount`, `emptyState`.
- **Verified:** new smoke `server/.smoke/g5b-restaurants-filter-test.js` 32/32. Full regression battery green — pure-JS C1 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18; DB suites c6-assign-table-override-wiring 14/14, g-auto-confirm-picker 11/11, g-prune 5/5, g-restaurant-settings 26/26; smoke-tierd2/e1/e2/f1/f2/i1/i3 all SMOKE OK (smoke-tieri3 confirms the moved `computeMergeSuggestions`; smoke-tiere1/e2 confirm the moved `timeMinutesFitsOpenWindow`). Android Metro bundle builds clean (HTTP 200, 7.05 MB).
- **No schema changes, no migrations.**

**Tier G commit 6 — SHIPPED (see the top of this file).**

---

**Earlier last session: 2026-05-20. Tier G commit 5a SHIPPED — Location filter on the mobile home screen (§5.1, Location only — party/date/time deferred to G5b).**

- **§5.1 Location filter.** `apps/mobile/src/screens/HomeScreen.js` gains a "Nearby" chip in a new filter row above the cuisine chips. Tap → `expo-location` `requestForegroundPermissionsAsync()` (called ONLY on the explicit tap, never on render — Expo caches the grant, so an already-granted user is not re-prompted) → `getCurrentPositionAsync()` → `coords` state → `lat`/`lng` sent on the `GET /restaurants` query. Backend's existing Haversine sort orders by distance; the per-card "X away" hint (already coded, previously dormant — `distance` was never returned) goes live. Tapping an active chip deactivates (clears coords). On permission-denied / GPS-error: filter stays off, localized hint shown below the chip.
- **Permission flow:** request-on-first-use (on filter activation), not on screen load. `expo-location@~19.0.8` was ALREADY a dependency — no `expo install` needed.
- **i18n:** 6 new keys under `homeFilters.*` (RO + EN) — `nearby`, `locating`, `locationDenied`, `locationError`, `distanceMeters`, `distanceKm`. HomeScreen had no i18n hook; `useTranslation` from `react-i18next` added. The distance hint was hardcoded English and is now localized (it's part of the location feature's surface). Rest of HomeScreen stays hardcoded English (pre-existing debt, out of scope).
- **Verified:** Android Metro bundle builds clean (HTTP 200, ~7.37 MB — consistent with the G4 7.32 MB baseline; `expo-location` resolved 9 refs, `react-native-maps` still 39 refs). Pure-JS smokes green: C1 dispatcher 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18.
- **No schema changes, no backend changes, no new endpoints.**

**✅ DEFERRED VERIFICATION — RESOLVED 2026-05-20.** Railway Postgres recovered; the full `[post-railway-recovery]` regression battery ran green against the live DB. Pure-JS: C1 dispatcher 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18. DB-dependent: c6-assign-table-override-wiring 14/14, g-auto-confirm-picker 11/11, g-prune-old-reservations 5/5, g-restaurant-settings 26/26. Tier smokes: smoke-tierd2 / e1 / e2 / f1 / f2 / i1 / i3 all SMOKE OK. **Zero reds — G2/G3/G4/G5a confirmed clean against Railway; the TODO is cleared.**

**Tier G commit 5b — SHIPPED (see the top of this file).**

**Earlier last session (2026-05-20): Tier G commit 4 SHIPPED — service-period filter on the Live page + Google Maps embed on the mobile restaurant profile.**

- **§6.3 service-period filter.** New shared component `apps/restaurant/components/ServicePeriodFilter.jsx` (a `<select>` of the restaurant's service periods, "All periods" default). Mounted on the Live floor plan above the Section tabs. Client-side filter: with a period selected, a table's guest overlay renders only when its reservation `time` is inside the period's `[startTime, endTime)` (helper `timeInPeriod`, cross-midnight aware); the table card itself always renders. **Audit correction:** the Tier G kickoff audit claimed the Calendar already had this filter inline and framed G4 B1 as a "pure refactor" — that was wrong. Neither Calendar nor Live had a service-period filter (Calendar has Date + Section selects only). Built the component fresh, mounted on Live. The Calendar's own §6.4 service-period filter is still open (noted in SPEC §15).
- **§5.2 Google Maps embed.** `react-native-maps@1.20.1` installed via `expo install` (SDK 54 compatible). `RestaurantDetailScreen.js` renders a read-only `<MapView>` + single `<Marker>` at the restaurant lat/lng, rounded card below the address. Platform-default provider (Apple Maps iOS / Google Maps Android) — not `PROVIDER_GOOGLE`, which would need an iOS API key and break the Expo Go preview. Omitted when lat/lng null. lat/lng arrive as Prisma `Decimal` → JSON strings, so `parseFloat`-coerced + finiteness-guarded. Headerless (matches the headerless Menu section) → no new mobile i18n strings.
- **Bundled fix — `apps/mobile/metro.config.js` (NEW).** The Expo app had NO Metro config, so Metro couldn't resolve `src/lib/colors.js`'s relative import into `<repo>/packages/shared` — **every mobile bundle has been failing** with `Unable to resolve module ../../../../packages/shared/theme/colors`. Pre-existing breakage, not G4-introduced. Added the standard Expo-monorepo config (`watchFolders` = repo root, dual `nodeModulesPaths`). Android JS bundle now builds clean (HTTP 200, ~7.3 MB, `react-native-maps` resolved). **Implication: prior Tier D/E mobile work was never bundle-verified — worth a real-device pass on the diner app generally.**
- **i18n:** 2 keys `servicePeriodFilter.{label,all}` (restaurant app, RO + EN). 0 mobile keys (headerless map).
- **Verified:** restaurant `/dashboard/live` + `/calendar` + `/settings` compile + serve 200; Android Metro bundle builds clean. Pure-JS smokes green: C1 dispatcher 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18.
- **No schema changes, no backend changes, no new backend endpoints, no auth changes.**

**✅ DEFERRED VERIFICATION — RESOLVED 2026-05-20.** The G4-era `[post-railway-recovery]` TODO is cleared. Railway Postgres recovered; the full deferred battery ran green — see the G5a entry above for per-suite totals. Every deferred suite (`c6-assign-table-override-wiring`, `g-auto-confirm-picker`, `g-prune-old-reservations`, `g-restaurant-settings`, `smoke-tierd2/e1/e2/f1/f2/i1/i3`) passed against the live DB with zero reds.

**Tier G commit 5 (next, waits for Sebastian's approval):** §5.1 mobile home multi-filter — Location (GPS; backend already supports `lat`/`lng` Haversine sort, UI-only) + party-size/date/time (UI + backend `GET /restaurants` query-param extension). Audit suggested splitting 5a (Location, cheap) + 5b (party/date/time). Sebastian will also decide whether to wait for Railway recovery before starting G5.

**Earlier last session (2026-05-20): Tier G commit 3 SHIPPED — restaurant Settings save expansion + staff-side photo/menu upload endpoints + Settings page wiring.**

- **`PUT /api/restaurant/settings` expanded.** A minimal handler (only `autoConfirmEnabled`) already existed — the G1 audit's "silent bug / route not mounted" claim was WRONG (the audit agent missed the route; the toggle worked). G3 expands it to the full §6.7 whitelist: `autoConfirmEnabled, descriptionRo, descriptionEn, phone, email, website, openingHours, servicePeriods`. Strict unknown-field guard (any other field, incl. forged `restaurantId`, → 400 `{ error: { code: 'unknown-field', field } }`). `+40` phone validation via G2's shared helper → structured `invalid-phone-format`. Returns GET /profile shape. restaurantId always JWT-derived.
- **Staff photo/menu upload endpoints** — new `server/src/routes/restaurantUploads.routes.js`, mounted at `/api/restaurant`: `POST /photos`, `DELETE /photos/:photoId`, `PUT /photos/:photoId/cover`, `POST /menu`, `DELETE /menu`. `authenticateRestaurant`-gated; restaurantId from JWT. Photo delete/cover return 403 `forbidden` on cross-tenant photoId. (Option A — duplicate endpoints, not re-keyed admin ones.)
- **Shared logic, zero drift:** `lib/uploads.js` multer destination now reads `req.uploadRestaurantId || req.params.id` (staff routes set it from JWT via a tiny middleware; admin routes still use `:id`). multer config + file validation single-sourced there. New `server/src/lib/restaurantProfile.js` (`applyOpeningHours`/`applyServicePeriods`) shared by the admin restaurant-edit endpoint AND the new PUT /settings — admin.routes.js refactored to call it.
- **Frontend:** `apiUpload` + `uploadUrl` added to `apps/restaurant/lib/api.js`. New `apps/restaurant/components/PhotosSection.jsx` + `MenuSection.jsx` (ported from admin twins, JWT-scoped paths, no `restaurantId` prop). Mounted on the Settings page. `handleSaveProfile` rewired `PUT /profile` → `PUT /settings` (so contact phone is +40-validated; malformed phone surfaces localized `settings.errorInvalidPhone`). GET /profile now includes `photos`. `photoUpload.*` + `menuUpload.*` + `settings.errorInvalidPhone` i18n keys added (RO + EN).
- **Legacy `PUT /api/restaurant/profile`** left mounted but no longer used by the Settings page — not deleted (out of scope; low risk to leave).
- **Smoke `g-restaurant-settings-test.js` 26/26.** Regression battery all green: C1 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18, C6 assign-table-override-wiring 14/14, G2 picker 11/11, G2 prune 5/5, Tier F1 (admin photo/menu — verifies the uploads.js refactor) SMOKE OK, F2 / D2 / E1 / E2 / I1 / I3 SMOKE OK. Restaurant app `/dashboard/settings` compiles + serves 200.
- **No schema changes, no migrations.**

**Tier G commit 4 (next, waits for Sebastian's approval):** §6.3 service-period filter on the Live page (extract Calendar's inline `<select>` into a shared `ServicePeriodFilter` component, mount on Live, client-side filter) + §5.2 Google Maps embed on the mobile restaurant profile (`react-native-maps` + `<MapView>` using the lat/lng already on the payload). G5 (mobile home multi-filter) and G6/G7 (schema migrations gated on `--accept-data-loss`) still stand per the audit's 5-commit split.

**Earlier last session (2026-05-20): Tier G commit 2 SHIPPED — three independent backend changes: +40 phone enforcement, most-free-neighbors auto-confirm tiebreak, 30-day reservation pruning cron.**

- **§3.1 +40 phone enforcement.** New shared `server/src/lib/phoneValidation.js` (`ROMANIAN_PHONE_RE`, `PHONE_FORMAT_MSG`, `phoneFormatErrorBody()`). Structured `{ error: { code: 'invalid-phone-format', message } }` (Tier E/F contract) now emitted at four diner/guest phone DB-write paths: register, diner profile update, staff-created reservation `guestPhone` (regex newly added — was `notEmpty` only, `.bail()` keeps "required" distinct), staff reservation edit `guestPhone` (newly added). Both `handleValidationErrors` middlewares (user + restaurantPlatform) upgraded. Restaurant-entity phone (admin onboarding, restaurant Manage-Profile contact) deliberately left alone — §3.1 governs diner phone, venue lines may be landlines.
- **§9.3 most-free-neighbors tiebreak.** `countFreeAdjacents()` added to `server/src/lib/tableMerges.js`. The `POST /api/reservations` auto-confirm picker now, when >1 exact-seat-match table is free, ranks by free Manhattan-1 same-section neighbor count. Single-candidate case unchanged (no extra query). `eligible-tables` / `/availability` / mobile availability keep `gte` semantics — untouched.
- **§3.2 30-day pruning cron.** New `server/src/jobs/pruneOldReservations.js` — hard-deletes terminal-status (COMPLETED/NO_SHOW/CANCELLED) reservations strictly older than 30 days. Idempotent. Bootstrapped from `index.js` on its own 24h `setInterval` (boot-run + daily), off the `socket/handlers.js` minute-loop.
- **New smokes:** `g-auto-confirm-picker-test.js` 11/11, `g-prune-old-reservations-test.js` 5/5.
- **Regression battery all green:** C1 dispatcher 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18, C6 assign-table-override-wiring 14/14, Tier D2 / E1 / E2 / F2 / I1 / I3 SMOKE OK.
- **No schema changes, no migrations.** A picker-smoke bug (the `POST /reservations` response `select` omits `tableId`) was fixed in the smoke itself by reading `tableId` back from the DB — flagged here in case a future tier wants `tableId` on that response.
- **Windows note:** the backend nodemon crashed `EADDRINUSE` mid-session — a stale pre-G2 instance held :4000 while the reload child couldn't bind. Cleared by `taskkill /F /T` on the :4000 PID + TaskStop on the dead bash task, then a clean restart. `taskkill` flags get mangled by Git-bash path conversion — run it via the PowerShell tool, not Bash.

**Tier G commit 3 (next, waits for Sebastian's approval):** new `PUT /api/restaurant/settings` endpoint (fixes the silent-bug — `settings/page.js:96` posts to a route that doesn't exist) + staff-side photos/menu upload endpoints (`authenticateRestaurant`-gated, mirror the admin F1 endpoints) + mount `PhotosSection`/`MenuSection` on the restaurant Settings page + wire the auto-confirm toggle to the new PUT. Audit's full 5-commit split (G4 = service-period filter on Live + mobile Maps embed, G5 = mobile home multi-filter, G6+G7 = schema migrations gated on `--accept-data-loss`) still stands.

**Earlier last session (2026-05-20): Tier G commit 1 SHIPPED — orphan dead-code remnants stripped + SPEC §15 stale entries closed out.** Audit found §15 had drifted significantly out of sync with the code: §9.3 exact-match, §3.4 OTP, §7.4 analytics, §7.5 billing, waitlist routes, all three §8.1 crons, and §9.1 specialRequests were all flagged as open but already shipped by prior tiers. G1 closes the documentation debt + removes three small code remnants:

- Deleted the orphan OTP-send stub in `auth.routes.js` `/login` phone-branch (lines 133-142 pre-G1) that generated an OTP and pointed clients at `/verify-otp` which no longer exists. Phone login is no longer a path; `/login` is email + password only per §3.4. Tightened the validator (`email().isEmail()` + `password().notEmpty()` — no more `.optional()` on both).
- Deleted `WAITLIST_STATUS`, `WAITLIST_CONFIRM_WINDOW_MIN`, `WAITLIST_SECOND_REMINDER_MIN` orphan exports from `packages/shared/src/constants/index.js`.
- Stripped the stale `'waitlist_available'` example from the `Notification.type` doc comment in `server/prisma/schema.prisma:485` (now reads `'modification_requested'`).
- Rewrote `SPEC.md` §15 to move 7 already-shipped items into a new "Resolved before Tier G (housekeeping)" section with code-location citations, and added a new entry capturing the silent-bug found in audit: `apps/restaurant/app/dashboard/settings/page.js:96` calls `PUT /api/restaurant/settings` which doesn't exist — auto-confirm toggle fails silently today. Slated for G3.

**No schema migrations, no behavioral changes, no new routes.** The `/login` phone-branch deletion is dead-code removal (with the OTP-send endpoint gone, any phone-only POST returns 401 anyway).

**Regression battery: all green** — C1 dispatcher 12/12, C6 popup-actions 19/19, C6 live-grid-layout 18/18, C6 assign-table-override-wiring 14/14, Tier D2 SMOKE OK, E1 SMOKE OK, E2 SMOKE OK, F2 SMOKE OK, I1 SMOKE OK, I3 SMOKE OK.

**Tier G commit 2 (next, waits for Sebastian's approval):** §3.1 `+40` phone regex on `/auth/register` + §9.3 "most free neighbors" auto-confirm tiebreak (extract `countFreeAdjacents()` to `tableMerges.js`) + §3.2 30-day reservation pruning cron (separate day-granular `setInterval`, NOT folded into `socket/handlers.js` minute-loop) + new picker smoke at `server/.smoke/g-auto-confirm-picker-test.js`. The audit's full 5-commit Tier G split is preserved in the audit reply (G3 = staff Settings PUT + photos/menu, G4 = service-period filter on Live + mobile Maps embed, G5 = mobile home multi-filter, G6 + G7 = schema migrations gated on `--accept-data-loss`).

**Earlier last session (2026-05-17): Tier I COMPLETE end-to-end — commit 3 (calendar propagation + edge polish) SHIPPED. SPEC §8.2 fully resolved. Override flow + drag UX + calendar wiring + auto-deactivate lifecycle hooks all green across the full regression battery.**

Tier I commit 3 details:
- **Calendar** (`apps/restaurant/app/dashboard/calendar/page.js`): merged-reservation blocks render an amber `+T3` badge inside the existing single-column block (decision 4 — no grid math change). Tooltip on the badge shows the full combined label ("T1+T3").
- **Reservations page** (`apps/restaurant/app/dashboard/reservations/page.js`): Table column appends `merged: T1+T3` amber pill when `res.mergeBinding != null`.
- **`/availability` endpoint** promoted: `suggestionForCombining` is now derived from a new `mergeSuggestions: [{tableIds, memberLabels, combinedLabel, summedSeatCount, freeNeighborCount}, ...]` array (top 3). Helper `computeMergeSuggestions()` walks BFS-grown adjacency frontiers up to MAX_MERGE_MEMBERS=4, ranks by (smallest viable merge first, highest freeNeighborCount, tightest fit).
- **`/restaurant/reservations` list** gains per-row `mergeBinding: { groupId, combinedLabel, memberLabels, otherMemberLabels, summedSeatCount } | null`. Single batched query for active TableMove rows + their group members; in-memory join on `timeRangesOverlap(move.time, res.time)`. `otherMemberLabels` excludes the row's own table label.
- **Auto-deactivate hooks were already wired in I1** via `deactivateMergesForReservation()` at `server/src/lib/tableMerges.js`. Tier I3 smoke verifies all four lifecycle sites (restaurant cancel/complete/no-show + diner cancel) — bound merges deactivate; pre-planned merges (reservationId=null) survive unrelated reservation cancels (smoke [h]).

**Smoke results**: smoke-tieri3.js 38/38 paths PASS across the 8 scenarios.

**Full regression battery green**: c6-assign-table-override-wiring 14/14, c6-live-grid-layout 18/18, c6-popup-actions 19/19, c1-dispatcher 12/12, Tier I1 12/12, Tier I3 38/38, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22.

**QA fixture cleaned** — reservation `4577ea13-...` CANCELLED, section `7c09e62a-...` + 9 tables deleted via the F2 endpoint (with the TableMove pre-purge workaround for the FK KNOWN ISSUE still deferred to Tier J).

**Tier G (cleanup pile from SPEC §15 still-open list) waits for Sebastian's approval.** Open items: §3.1 +40 phone format validation gap on `/auth/register` (E1 fixed `/modify` but not register), §3.2 30-day reservation pruning cron, §3.4 OTP routes still mounted (delete), §6.7 staff Manage Profile photos/menu/auto-confirm toggle, §7.6 auto-confirm toggle UI per §6.7, §8.1 "Arriving Soon" auto-transition cron, §8.1 Awaiting Guest auto-transition + 15-min recurring reminder, §8.1 120-min Occupied timer + expiry alert, §9.3 auto-confirm picker "most free neighbors" + exact-seat-match fix (deferred from Tier I plan), `TableMove.tableId` FK cascade fix (KNOWN ISSUE blocking smooth section-delete on tables with merge history), admin Analytics + Billing dead-code deletion (§7.4 + §7.5 cut from MVP), waitlist server routes + schema removal (cut from MVP), the `MODIFICATION_PENDING` enum value (deprecated dead code, kept).

**Earlier this session:**

Tier I commit 2 fix-the-fix #4 SHIPPED — OverrideConfirmModal now actually reachable from soft-ineligible card click (not just a window.alert with the raw backend string).** Cowork manual QA caught that the click handler in confirm-mode surfaced a browser alert instead of the localized modal, despite all the prior fix-the-fixes wiring the modal component itself.

**Root cause.** The restaurant app's `apps/restaurant/lib/api.js` `handleResponse` threw a bare `new Error(msg)` without attaching `err.payload` + `err.status`. The live-page catch at `handleAssignFromConfirm` reads `err?.payload?.error?.code` — always undefined → branch always missed → fell through to `alert('Failed to assign table: ' + err.message)`. The **admin** app got `err.payload` attachment in Tier F2 (commit `d2fea93`), but the **restaurant** equivalent was never patched. Two parallel api.js files, only one fixed.

**Fix.** Mirrored the admin pattern in `apps/restaurant/lib/api.js`: attach `err.status = response.status` + `err.payload = data` in the !ok branch of `handleResponse`. One-semantic-line change. Defensive infrastructure — benefits any future structured-error handling on the restaurant side (modification 409s, disabled-date 400s, etc., though those flows had no current consumer requiring this).

**Source-grep sweep across `apps/restaurant/`** for `/assign-table` PUTs: exactly ONE call site — `live/page.js:182` inside `handleAssignFromConfirm`. The popup's `reassignTable` action variant forwards via `onAction`, but the Live page's `onAction` callback just closes the popup + refetches (no PUT). No second wiring site to fix.

**New defensive smoke** at `server/.smoke/c6-assign-table-override-wiring-test.js` (14/14 PASS):
- Static source-grep that `apps/restaurant/lib/api.js` retains the `err.payload = data` + `err.status = response.status` attachments (catches the regression class even if no runtime path triggers).
- End-to-end runtime assertion that `PUT /assign-table` on a party-too-large condition returns 409 with the full structured body (`error.code='party-too-large'`, `tableLabel`, `seatCount`, `partySize`, `mergeGroupId`) AND that the simulated api.js convention populates `err.payload.error` correctly.
- Re-PUT with `{ force: true }` → 200 + reservation.tableId mutated.

**Full regression battery green**: c6-live-grid-layout-test 18/18, c6-popup-actions 19/19, c6-assign-table-override-wiring 14/14, Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12.

QA fixture preserved (section `7c09e62a-...` + reservation `4577ea13-...`). Sebastian re-walks the manual confirm-mode click — modal should now render with localized copy ("Party doesn't fit this table" / "Numărul de persoane depășește masa"), Confirm re-POSTs with force=true, success toast appears.

**Earlier this session:**

Tier I commit 2 fix-the-fix #3 SHIPPED on top of #2 — TDZ regression on Live page first render in confirm-mode resolved.** Two bugs introduced by fix #2 (commit 698e9e8):

1. **TDZ ReferenceError on every confirm-mode mount.** Fix #2 hoisted `handleDragOver` (useCallback with deps `[dragSourceId, tables, liveByTableId]`) above the declaration of `tables`. `useCallback`'s dep array is evaluated synchronously during render, so the page crashed with Next.js's runtime error overlay: `ReferenceError: Cannot access 'tables' before initialization` at `live/page.js:268`.

2. **Self-referencing `const dragHandleTooltip = dragHandleTooltip`.** Fix #2 used `replace_all` on `t('merge.handleTooltip')` → `dragHandleTooltip` which also clobbered the declaration site itself, producing `const x = x` (undefined-or-TDZ depending on how V8 hoists).

Fix #3 (one focused commit):
- Reordered the derived state block — `currentSection`, `tables`, the `useMemo` for `gridLayout`, and the hoisted `overrideTinyHint` / `dragHandleTooltip` translations — to live BEFORE the drag-handler `useCallback`s. The render-perf intent of fix #2 stays intact; only the declaration order moves.
- Restored `const dragHandleTooltip = t('merge.handleTooltip')` correctly.
- SSR check: both `/dashboard/live` and `/dashboard/live?confirmReservationId=4577ea13-...` return 200 (substantive HTML, no error overlay).
- Source-grep sweep across the file's 4 useEffect + 4 useCallback + 1 useMemo sites: only the live-page block was at risk; everything else has either `[]` deps or references state declared at the top of the component (useState calls at lines 47-92). No sibling TDZ risks elsewhere in `live/page.js`. Sister files (`ReservationDetailPopup.jsx`, `QuickAddReservation.jsx`, etc.) weren't touched in fix #2.

Regression battery all green: new `c6-live-grid-layout-test` 18/18, C6 popup-actions 19/19, Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12.

QA fixture preserved (section `7c09e62a-...` + reservation `4577ea13-...`) — Cowork resumes confirm-mode QA against it.

**Earlier this session:**

Tier I commit 2 fix-the-fix #2 SHIPPED — Live confirm-mode renderer hang resolved. Tier E + Tier F + Tier D all FULLY COMPLETE from earlier sessions.** Cowork browser QA caught a 45s+ renderer freeze on subsequent state changes in confirm-mode (Chrome extension reported "renderer may be frozen or unresponsive"; CDP Runtime.evaluate timed out). First render fine; second interaction → hang. Reproduced on fresh tabs.

**Root cause (best inference — no live repro was possible since the freeze blocks DevTools).** The Live page's JSX had an inline IIFE that rebuilt the merge-group Map + claimedCells Set + bounding-box math + L-shape detection on EVERY parent render — including renders triggered by `dragHover`, `overrideInfo`, popup state, 30s interval, any state change unrelated to merge layout. Combined with per-cell `t()` lookups and inline-arrow `onDragOver`/`onDrop` handlers (new fn references each render → React re-attaches listeners on every cell), the per-interaction cost compounded under React 18 concurrent rendering until it freezing the renderer.

**Fix (three-part, all in one commit):**
- Extracted the IIFE's pure computation into `apps/restaurant/lib/liveGridLayout.js` (`computeLiveGridLayout(tables, liveByTableId)` → `{ mergeGroups, claimedCells }`). Plain JS, no React imports, Node-importable.
- Live page wraps it in `useMemo` keyed on `[tables, liveByTableId]` — transient state changes no longer recompute.
- `useCallback` on `handleDragStart`/`handleDragEnd`/`handleDragOver`/`handleDragLeave` so per-cell drag handler refs stay stable across renders.
- Hoisted per-cell tooltip translations (`t('merge.handleTooltip')`, `t('override.tinyHint')`) once per render.
- Helper returns mergeGroups sorted by groupId so React `key` stability holds.

**Perf guard at `server/.smoke/c6-live-grid-layout-test.js`** — 18/18 PASS:
- Purity (same input → same output across two calls)
- Rect vs L-shape detection (no phantom corner cell on L-shapes)
- Inactive merges filtered
- Deterministic groupId ordering for React `key` stability
- Empty-case fast path
- **O(N) perf budget**: 1000 tables × 250 merges in <50ms (measured 1.18ms)
This catches the regression class as a Node smoke fail rather than a 45s browser hang.

**QA debris cleanup**: reservation `ddef5ce5...` CANCELLED via staff endpoint + section `02b4a90f...` (9 tables) deleted via the F2 admin endpoint (with the TableMove pre-purge workaround for the FK known issue still deferred to Tier J).

**Regression battery all green**: C6 popup-actions 19/19, Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12, new c6-live-grid-layout-test 18/18.

**Tier I commit 3 (calendar propagation + edge polish — "+T3" badge in first member's column per decision 4, availability hint promotion) waits for Sebastian's re-QA of the confirm-mode hang fix in Chrome** — open the URL with a fresh party-of-10 reservation, expect first render fine + subsequent state changes (section tab clicks, card clicks) to remain responsive.

**Earlier this session:**

Tier I commit 2 fix-the-fix SHIPPED on top of I2 + I1. Tier E + Tier F + Tier D FULLY COMPLETE from earlier in the session.** Cowork's I2 browser QA caught one blocking bug + two cosmetic touches; all three closed in this fix commit, plus the QA debris cleanup. Full record in SPEC §15 Resolved-by-Tier-I-commit-2 fix-the-fix entry.

- **Blocking — OverrideModal unreachable from confirm-mode**: refactored the cell eligibility logic in `apps/restaurant/app/dashboard/live/page.js` into three buckets:
  - `hardDisabled` = OCCUPIED || OUT_OF_SERVICE (truly not assignable)
  - `softIneligible` = in-confirm-mode + !isEligible + party-doesn't-fit (table.seatCount < partySize OR merge.summedSeatCount < partySize). Stays clickable, dashed orange border + bg-orange-50/60 tint + tooltip "click to override". Click routes through assign-table → 409 party-too-large → OverrideModal opens.
  - `conflictIneligible` = in-confirm-mode + !isEligible + table large enough but booked. Stays hard-disabled — no override path exists for time-conflict today.
  Same split applied to merge spanning cards. Defensive source-grep confirmed only live/page.js renders confirm-mode cards.
- **Cosmetic — synthetic-merge popup status chip**: when the popup opens on a merge with no bound reservation, the Live page synthesizes a placeholder reservation (id: null, status: 'AUTO_CONFIRMED'). The status chip rendered that as "Auto-confirmed" — false claim. Suppressed via `isSyntheticMerge = hasActiveMerge(current) && current.id == null`; replaced with neutral amber chip "Merged tables · no current reservation" / "Mese unite · fără rezervare curentă".
- **Cosmetic — merge popup Table field**: body Table field showed lead member tableNumber instead of the combined label that's in the header chip. Switched to `displayTableLabel = hasActiveMerge(current) ? current.merge.combinedLabel : tableLabel`. Body now matches header ("TI-1+TI-2").
- **2 new i18n keys** under `override.{tooltipHint,tinyHint}` + 1 under `mergePopup.noReservationStatus`. RO + EN parallel.
- **QA cleanup**: reservation b1bd28c3 routed through staff cancel (CANCELLED); section 481f2692 routed through F2 admin delete (200, tablesRemoved:9). Both gone. Workaround surfaced a real **pre-existing FK bug**: `TableMove.tableId` references `RestaurantTable` with default RESTRICT, so F2 section-delete cascade FK-fails when QA tables have TableMove history. Pre-Tier-I, TableMove rows were never written so it didn't bite. **Schema fix (onDelete: Cascade on TableMove.table) drafted but deferred to Tier J** — the fix-the-fix turn didn't authorize a schema migration. The fix is one-line and additive; details inline at `server/prisma/schema.prisma` TableMove model "KNOWN ISSUE" comment + the workaround in `server/scripts/cleanup-tieri-qa.js` (delete TableMove rows first, then call F2).
- **Regressions all green**: C6 popup-actions 19/19, Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12.

**Tier I commit 3 (calendar propagation + edge polish — "+T3" badge in first member's column per decision 4, availability hint promotion) waits for Sebastian's re-QA of the fix-the-fix in Chrome.**

**Earlier this session:**

Tier I commit 2 (Live overlay drag UX + override modal) SHIPPED on top of commit 1. Tier E + Tier F + Tier D FULLY COMPLETE from earlier in the session.** I2 lives entirely on the Live page + popup + new OverrideModal component — no backend changes (I1 already ships the contract). High-regression-risk surface; defended via 19/19 C6 popup-actions cases + the full backend regression battery, all green.

Key implementation details (full record in SPEC §15 Resolved-by-Tier-I-commit-2):
- **Live page two-pass render** at `apps/restaurant/app/dashboard/live/page.js`: pass 1a emits rectangular merges as single spanning cards via CSS `gridColumn/gridRow: span N`; pass 1b L-shape fallback renders per-member with shared amber border (no phantom corner cell); pass 2 iterates the grid skipping cells in `claimedCells` Set. All cards keep `min-h-[80px]`. The C6 §3.7 80px invariant is preserved (drag handle reuses the top-row chip space next to the seat count).
- **Drag handle**: native HTML5 `draggable` on a ⠿ glyph span ONLY (not the parent button); stopPropagation on click/mousedown so tap-to-popup still works. Visible only on non-OCCUPIED, non-OUT_OF_SERVICE, non-confirm-mode tables (mirrors server merge-eligibility).
- **Drag flow**: `onDragOver` does the adjacency + 4-cap pre-check client-side, sets amber-ring drop hint on valid targets; invalid targets get the not-allowed cursor (default). `onDrop` composes union of source+target groups, POSTs to `/api/restaurant/tables/merge`. Reservation-bound when in confirm-mode; default window is now→23:59 otherwise.
- **`table:merged` + `table:unmerged` socket subscribers** trigger quiet refetch. The C4 `useSocketRefetch` covers reconnect/tab-focus, so merged-card state stays consistent across §4.4.
- **Popup merge sub-header** (amber chip with combinedLabel + summedSeats) renders when `current.merge?.isActive`. `popupActions.actionsForStatus` appends `unmerge` payload-keyed (same pattern E1 introduced for MODIFICATION_PENDING). New `unmerge` ActionButton variant (amber) wired to PUT `/api/restaurant/merges/:groupId/unmerge`.
- **OverrideModal** standalone component triggered by 409 `party-too-large` from assign-table; uses `err.payload.error.{tableLabel,seatCount,partySize}` from the I1 structured body. "Assign anyway" re-POSTs with `force: true`.
- **~16 new i18n keys** under `merge.*` + `override.*` + `actions.unmerge`. RO + EN parallel.
- **C6 popup-actions smoke extended** with scenarios J/J'/J''/J''' (merge appended on CONFIRMED, suppressed on OCCUPIED, ignored when stale `isActive=false`, modification-pending wins). 19/19 PASS.
- **QA fixture script** at `server/scripts/seed-tieri-qa-fixture.js` creates a contiguous 3×3 `[Tier I QA]` section at La Mama because the demo seed has no Manhattan-1 adjacencies. Idempotent.
- **Regression battery all green**: Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12.

**`memory/waiter_ux_strategy.md` §3.7** updated with the merged-card render contract + drag-handle convention so future tier work doesn't relitigate.

**Tier I commit 3 (calendar propagation + edge polish — badge in first member's column per decision 4, availability hint promotion) waits for Sebastian's Cowork browser QA of I2** via the QA fixture seeded above.

**Earlier this session:**

Tier I commit 1 (backend table-merging data model + endpoints; ZERO UI change) SHIPPED. Tier E + Tier F + Tier D all FULLY COMPLETE from earlier in the session.** I1 backend-only commit landed:

- **Schema**: `TableMove.mergeGroupId String?` additive nullable + indexed; `mergedWithTableId` tagged deprecated via schema comment (no code reads/writes it after I1). The cap of 4 members is enforced at write time, not by the DB.
- **3 new + 4 modified endpoints**:
  - `POST /api/restaurant/tables/merge { tableIds[2..4], date, timeStart, timeEnd, reservationId? }` — full guard suite:
    - `400 merge-too-small` / `400 merge-cap-exceeded` (with requested/cap counts)
    - `400 invalid-time-window` (start ≥ end)
    - `404 tables-not-found` (cross-tenant defense)
    - `400 cross-section-merge`
    - `400 not-adjacent` (with members[] payload)
    - `409 member-not-mergeable` (with blocked[] for OCCUPIED/OUT_OF_SERVICE — decision 3)
    - `409 merge-window-conflict` (with conflicts[] of overlapping active merges)
    - `409 reservation-conflict` (other reservations in window; the bound `reservationId` is exempt — hybrid scope per decision 1)
    - Returns 201 with the materialized group; emits `table:merged` to the restaurant room
  - `PUT /api/restaurant/merges/:groupId/unmerge` — atomic deactivation of every member row in one `updateMany`; emits `table:unmerged`; idempotent (returns 200 + `deactivated:0` if all members are already deactivated rather than 404)
  - `PUT /api/restaurant/reservations/:id/assign-table { tableId, force? }` — now 409 `party-too-large` with structured body (`tableLabel`, `seatCount`, `partySize`, `mergeGroupId`) when the party exceeds the effective seat count (single-table count OR merge `summedSeatCount` if the target is in an active merge whose window covers the reservation's time). `force: true` bypasses.
  - `PUT /api/restaurant/tables/:id/seat` — walk-in resolver now finds any active merge the tapped table belongs to and flips every member to OCCUPIED in one `$transaction` + writes the single walk-in `TableActivity` + emits per-member `table:status-changed`. Response carries `mergeGroupId` so the caller knows the group context. Decision 6.
  - `GET /api/restaurant/layout/live` — each table now carries `merge: { groupId, members[{id, tableNumber}], summedSeatCount, combinedLabel, originalCell, isActive } | null`. Map computed once outside the table loop. Filtered to merges whose window covers "now" so tomorrow's pre-merges don't leak into today's overlay. Additive — today's UI ignores unknown fields → zero visual change.
  - Reservation lifecycle hooks: restaurant `/cancel`, `/complete`, `/no-show` + diner `/cancel`, ack-cancel now call `deactivateMergesForReservation()` and emit `table:unmerged` for every auto-deactivated group with a `reason` field (`reservation-cancelled` / `-completed` / `-no-show`). Pre-merges (null `reservationId`) survive — they're for end-of-day cron, decision 2.
- **Shared helper** at `server/src/lib/tableMerges.js`: `MAX/MIN_MERGE_MEMBERS`, `combinedLabel()` (sorts by tableNumber for stable strings), `isConnectedByAdjacency()` (BFS over Manhattan-1), `timeRangesOverlap()` (end-exclusive per §9.2), `findActiveMergeForTable()`, `loadMergeGroup()`, `activeMergeMapForRestaurant()`, `deactivateMergesForReservation()`. Single source of truth so the four call sites don't drift.
- **events.md** documents `table:merged` + `table:unmerged` payload shapes including the `reason` discriminator on lifecycle-driven unmerges.
- **Smoke 12/12 PASS** (`server/scripts/smoke-tieri1.js`) — creates its own `[smoke-i1]` 2×2 fixture section since the demo seed's Interior section spaces tables at 2-cell intervals (no Manhattan-1 adjacencies). Opens a real socket connection during the test to assert `table:merged`/`table:unmerged` actually fire.
- **Regressions all green**: Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C6 popup-actions 15/15, C1 dispatcher template render 12/12.

**Tier I decisions log (Sebastian-approved 2026-05-16) — do NOT re-litigate in I2/I3:**
1. **Scope: hybrid.** Merges with `reservationId` set tie to the reservation lifecycle; pre-merges (null `reservationId`) live until end-of-day cleanup.
2. **Cancellation: auto-deactivate** the bound merge when reservation cancels/completes/no-shows. Pre-merges = cron-driven cleanup.
3. **OCCUPIED + merge**: rejected with 409 `member-not-mergeable`. OUT_OF_SERVICE too.
4. **Calendar UX**: badge in first member's column ("+T3"), not column-spanning. I3 scope.
5. **Drag affordance**: dedicated drag handle icon in a card corner. I2 scope.
6. **Walk-in onto merge**: any member tableId resolves to the group transparently. Done in I1.
7. **Override modal**: standalone confirm modal triggered by 409 `party-too-large`. I2 scope.
8. **Deprecated `mergedWithTableId`** column kept with schema comment; no `--accept-data-loss` migration.
9. **§9.3 "most free neighbors" auto-confirm preference**: out of scope for Tier I. Keep on SPEC §15 list, pick up in Tier G cleanup.

**Tier I commit 2 (Live overlay drag UX + override modal, high regression risk to C6) waits for Sebastian's Cowork QA of I1 via curl** — the backend ships zero UI change.

**Earlier this session:**

Tier E FULLY COMPLETE — commit 2 (mobile diner request + Keep/Cancel ack) shipped on top of commit 1 (restaurant approve/reject). Tier F + Tier D also complete from earlier in the session. E2 backend: new `POST /api/reservations/:id/modifications/:modId/ack {action:keep|cancel}` with 4 error codes (`invalid-action`/`modification-not-rejected`/`modification-already-acknowledged`/`forbidden` 403). The cancel path mirrors the existing `PUT /:id/cancel` field-for-field in a single `prisma.$transaction` and fires `RESERVATION_CANCELLED_BY_DINER` (event #9) + `reservation:cancelled` emits to both rooms. Three new modify validations close the gap between POST /modify and POST /reservations: `date-in-past`, `date-not-available` (DisabledDate lookup), `time-outside-hours` (OpeningHours range). Drive-by fix: factored the opening-hours range check into `timeMinutesFitsOpenWindow()` and shared it between POST /reservations and POST /modify; both now handle cross-midnight close times (`closeTime='00:00'` → 24:00) correctly — pre-fix a 20:00 reservation at La Mama (open 10:00→00:00 Saturday) would 400. `GET /reservations/mine` + `/:id` reshaped to flatten `modificationPending` + `modificationRejected` onto each row. Mobile: new `ReservationDetailScreen.js` (per-reservation drill-down with cover photo, status badge, fields, action bar) reachable from `ReservationsScreen` card taps; new `RequestChangeScreen.js` (date/time/party stepper with current-value defaults, disabled-date gray-out, localized error surface for all 6 backend codes, pending success view); `ReservationsScreen` cards now navigate + render inline amber Keep/Cancel banner when `modificationRejected != null && acknowledgedAt == null`. Both new routes registered in `AppNavigator.AppStack`. ~25 new i18n keys (`reservationDetail.*` 14 / `modify.*` 11 / `modRejected.*` 10 / `errors.*` 7) — RO primary. End-to-end backend smoke `server/scripts/smoke-tiere2.js` 33/33 PASS including the 3 validation paths + 4 ack failure paths + the keep-ack-then-second-modify flow that exercises the modification-already-pending guard releasing on acknowledged rejections. Regression battery all green: Tier E1 31/31, Tier F2 24/24, Tier D2 22/22, C6 popup-actions 15/15, C1 dispatcher template render 12/12. **Tier I (table moving/combining drag UI per §8.2) waits for Sebastian's real-device Cowork QA of the diner modification flow.**

**Earlier this session:**

Tier E commit 1 (restaurant approve/reject + backend hardening) SHIPPED. Tier F + Tier D both FULLY COMPLETE from earlier in the session. E1 backend: three structured 400/409 pre-checks on `POST /api/reservations/:id/modify` (`reservation-not-modifiable` / `modification-already-pending` (with `existingId`) / `no-op-modification`); `PUT /api/restaurant/modifications/:id/approve` now wraps both writes in `prisma.$transaction` (verified via injected-failure rollback test producing Prisma P2025 with both rows unchanged); `GET /api/restaurant/reservations` now includes the latest PENDING modification and flattens it onto each row as `modificationPending: row | null` for the new tab. Schema: `ReservationModification.acknowledgedAt DateTime?` additive nullable (ack endpoint lands in E2); `ReservationStatus.MODIFICATION_PENDING` tagged deprecated via schema comment — kept in enum to avoid `--accept-data-loss`. Popup refactor: `popupActions.actionsForStatus` now payload-keyed (`modificationPending.status === 'PENDING'` → `['confirm','reject']`) with new exported `hasPendingModification()` helper. `ReservationDetailPopup.jsx` renders amber `bg-amber-50` callout above `<dl>` with `old → new` rows for only the changed fields, plus approve/reject ActionButtons reusing the `confirm`/`reject` variants with label overrides (`actions.approveModification` / `actions.rejectModification`) and explicit subtext suppression (ActionButton tweaked so `subtext === null` suppresses while `undefined` still picks the ambiguous-variant default — backward compat preserved). Click handlers PUT to `/api/restaurant/modifications/:modId/{approve,reject}` and toast. Reservations page adds a fourth tab "Modifications ({count})" with side-loaded count that auto-refreshes on `reservation:updated` events; row clicks open the standard popup; inline "Wants: …" diff snippet under the guest name. The `popup.modificationDeferred` / "Modification approval ships in Tier D." copy fully removed from both locales (source-grep clean). 8 new i18n keys. C6 popup-actions Node smoke extended with cases G/H/I (15/15 PASS). New regression smoke `server/.smoke/c1-dispatcher-templates-test.js` (12/12). E1 end-to-end smoke `server/scripts/smoke-tiere1.js` 31/31 PASS. Tier F2 + Tier D2 smokes re-run green. SPEC §15 §6.5 marked resolved; §5.6 still open for E2. **Tier E commit 2 (mobile diner request + reject-handling Keep/Cancel) waits for Sebastian's Cowork QA of the restaurant approve/reject UI.**

**Earlier this session:**

Tier F FULLY COMPLETE — commit 2 (disabled days + custom grid + section deletion + grid resize) shipped + fix-the-fix shipped for a nested-form bug in DisabledDatesSection. Commit 1 (photos + menu PDF) and Tier D also complete from earlier in the session. All 51 prior unpushed commits + the fix were pushed to origin/main (b5547f5..d2fea93 + the fix-the-fix on top). Fix variant chosen: variant (c) — dropped the nested `<form>` wrapper for a `<div>`, switched the Add button to `type="button" onClick={handleAdd}`, added `onKeyDown` Enter handler with `stopPropagation()` so Enter in the inputs calls the local handler without bubbling up to the outer `EditRestaurantPage` form. Root cause: nested forms are invalid HTML and the parent `EditRestaurantPage` form was capturing the Add button's submit, navigating instead of POSTing. Source-grep across `EditRestaurantPage` + `PhotosSection`/`MenuSection`/`ServicePeriods` found this was the only nested-form offender. Layout-editor buttons without `type="button"` flagged but not touched — layout editor has no parent form, so they're harmless defaults today. QA closure: re-ran `smoke-tierf2.js` (9/9 + Tier D2 + Tier F1 regressions all PASS) and a new `verify-tierf2-qa.js` that prints verbatim 409 bodies for `shrink-orphans-tables` + `section-has-reservations` plus verifies the past-only DELETE case (200 + past reservation row's `tableId` nulled in-txn). **Tier E (modification flow) waits for Sebastian's approval.**

**Earlier this session:**

Tier F commit 2 (disabled days + custom grid + section deletion + grid resize) SHIPPED. F2: reused existing `DisabledDate` model + `TableSection.gridRows/gridColumns` columns (no schema work). 3 new admin endpoints (`GET`/`POST`/`DELETE /api/admin/restaurants/:id/disabled-dates`) + 1 new diner GET (filtered to today-and-future). Section endpoints hardened with two structured 409 contracts: `shrink-orphans-tables` (with `orphanCount` + `sampleTables: [{id, tableNumber, gridRow, gridCol}]` + `newRows`/`newCols`) and `section-has-reservations` (with `count`/`nextDate`/`nextTime`, excludes CANCELLED/NO_SHOW; past-only attached → null tableId in txn then cascade-delete). Admin UI: `DisabledDatesSection.jsx` between Service Periods and Photos on the restaurant edit page; layout editor gains per-section "✏️ Edit grid" + "🗑 Delete section" buttons with two inline modals (`EditGridModal`, `DeleteSectionModal`) rendering localized 409 copy without a second round-trip — `apps/admin/lib/api.js` now attaches parsed JSON to `Error.payload` so handlers pull structured fields cleanly. ~28 new i18n keys (`disabledDates.*` + `sectionOps.*`). Mobile: `BookReservationScreen` fetches the disabled-dates list on mount and grays out matching dates in the horizontal date scroll with strikethrough + "—" marker; tapping shows a "Closed [reason]" alert. End-to-end backend smoke 9/9 + Tier F1 + Tier D2 regressions all green (`server/scripts/smoke-tierf2.js`). SPEC §15 §7.1 disabled-days + §7.2 grid/section ops marked resolved. **Tier F complete → Tier E next** (modification flow per the agreed order).

**Earlier this session:**

Tier F commit 1 (photos + menu PDF uploads) SHIPPED. F1: Railway-volume file uploads (dev fallback to `server/uploads/`, git-ignored), 5 new admin endpoints (`POST /admin/restaurants/:id/photos` + `DELETE` + `PUT cover` + `POST menu` + `DELETE menu`), shared multer helper at `server/src/lib/uploads.js` with `handleUploadError` middleware that surfaces stable `error.code` strings (`file-too-large`/`invalid-file-type`/`photo-limit-reached`), Express static at `/uploads` (public-by-design, 7-day cache), new `RestaurantPhoto.isCover` column (additive). Admin UI: `apps/admin/components/{PhotosSection,MenuSection}.jsx` wired into the restaurant edit page, 25 new i18n keys, responsive 2/3/4-col gallery, "★ Set cover" + "✕ Delete" buttons, client-side pre-validation. Mobile: new `mediaUrl()` helper, cover URL goes through it, horizontal swipeable gallery, "View Menu" button. End-to-end smoke 7/7 + static-serve + Tier D2 regression all green (`server/scripts/smoke-tierf1.js`). SPEC §15 §7.1 photos+menu marked resolved. **Tier F commit 2 (reservation-disabled days + custom grid dimensions + section deletion + grid resize) is next; gated on Sebastian's Cowork QA of the admin upload UI.**

**Tier D shipped earlier this session (recap below for context):**

Tier D COMPLETE — commit 2 (diner forgot-password + GDPR account deletion + phone-collection prompt) on top of commit 1 (restaurant-staff forgot). Schema additions for D2: `User.deletedAt` + `User.phonePromptSeenAt` (both nullable additive, pushed to Railway clean). Backend: `POST /api/auth/diner/forgot-password` + `POST /api/auth/diner/reset-password` (mirror of restaurant flow, scoped to `userType='user'`, emails an `aprez://reset-password?token=…` deep link via the C2 Resend transport). `DELETE /api/users/me` soft-deletes the user (sets `deletedAt`) and anonymizes PII on every linked reservation in a single transaction; auth middleware now rejects any `role='user'` JWT whose user has `deletedAt` set (returns 401 `account-deleted`), so stolen tokens can't survive deletion through the 7-day JWT TTL. `POST /api/users/me/phone-prompt-seen` stamps the dismissal column. Mobile: new `ForgotPasswordScreen` + `ResetPasswordScreen` in `AuthStack`; `LoginScreen` got the "Forgot password?" link; Expo Linking config in `app.json` (`scheme: "aprez"`) + `NavigationContainer linking` config route the deep link to `ResetPasswordScreen`. `ProfileScreen` got a "Danger zone" section with explicit warning modal calling `AuthContext.deleteAccount` (AuthStack auto-bounces once user clears). `BookReservationScreen` Alert promoted to inline `step=4` success view with optional `+40` phone-collection card for users where `User.phone == null && User.phonePromptSeenAt == null`. Drive-by bugfix: `AuthContext.updateProfile` was hitting non-existent `/users/profile` (404); now `/users/me`. ~44 new i18n keys across `apps/mobile/src/locales/{ro,en}.json`. End-to-end backend smoke 5/5 paths green (`server/scripts/smoke-tierd2.js`); Tier D1 restaurant-side regression also re-verified in the same script. **Tier D complete → Tier F next** (admin uploads: photos + menu PDF + reservation-disabled days + custom grid dimensions per SPEC §7.1/§7.2). Mobile-side QA of the deep link, profile delete UX, and step-4 phone prompt needs Sebastian's Cowork pass.

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
