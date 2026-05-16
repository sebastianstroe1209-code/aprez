# Waiter UX Strategy — Tier C6 Plan

>  Last locked: 2026-05-09 by Sebastian, after iterative review with Cowork. Update via a new version commit if scope changes.

---

## 1. Why this document exists

ApRez's restaurant platform must replace a notebook + printed floor map for a working waiter. Adoption depends on the platform feeling at least as fast as paper for the high-frequency moments of a shift — AND being reliable enough to trust during messy moments (conflicts, no-shows, late guests, bad WiFi). If it doesn't, the waiter quietly returns to paper and the restaurant decides ApRez "doesn't work for us" — a verdict that's near-permanent because re-onboarding is brutal.

This document defines the UX changes and operational rules that close that gap.

It exists as a separate file rather than embedded in SPEC.md because it's strategy/design + operational requirements, not behavioral spec. SPEC.md says *what* the platform does; this document says *how it should feel and behave for the user it's built for*.

Referenced from SPEC.md §15 and CLAUDE.md. Read before any restaurant-platform UI work.

---

## 2. The waiter's actual day

A working waiter at a small Romanian restaurant interacts with the platform in eight recurring scenarios, ranked by frequency and urgency:

**Pre-shift (1× per shift, ~3 minutes).** Walks in 30 minutes before opening. Wants to know how busy the night will be, who has special requests (birthdays, dietary), whether anything is in progress.

**Phone-in reservation (most frequent: 5–25× per shift).** Phone rings during service. Customer wants to book. Speed matters intensely — pen-and-paper benchmark is ~6 seconds. Slower than 15 seconds feels broken.

**Confirming app reservations (3–10× per shift).** A new pending request arrives from a diner via the mobile app. Waiter must be ALERTED to it (regardless of which page they're on), check availability, pick a table, confirm.

**Walk-in seating (3–15× per shift, peaks at rush).** Group arrives without booking. Waiter glances at the floor, finds a fitting table, marks it Occupied with the right party size. Eyes-on-floor only — no scrolling through pages.

**Status updates (30+× per shift).** Guest arrives → table goes Red. Guest leaves → table goes Green. Tiny actions but constant. One-tap.

**No-show handling (1–4× per shift on average).** A booked guest doesn't arrive after 15 minutes. Waiter marks them no-show and frees the table.

**Edit existing reservation (2–8× per shift).** Customer calls to change time, party size, or special requests. Waiter looks up the reservation, edits it, customer confirms over phone.

**Cancel reservation (2–8× per shift).** Customer cancels. Waiter looks up reservation, cancels.

Less-frequent flows (banning a guest, profile edits, modification request approval from diner-side) need to be functional but don't dominate UX priority.

**Modification request approval (from diner-side):** depends on mobile-app modification UI which doesn't exist yet. Both must ship together — defers to Tier D, not C6.

**Scope note:** this document covers the **restaurant platform** only. Admin tool defers to Tier J. Mobile diner app is addressed in Tier D.

---

## 3. UX changes — Tier C6 scope

Each item: WHAT, WHY, WHERE, CONNECTIONS, VERIFICATION.

### 3.1 Shared Reservation Detail popup — foundational (P0)

**WHAT.** A shared modal/popup component that displays a reservation's full details (name, party, time, phone, special requests, status, assigned table) plus all available actions (shown contextually based on reservation status — see matrix below). Opens from anywhere the user encounters a reservation: Reservations table row, Calendar block, Live floor plan table card, Dashboard upcoming list, search results.

**Available actions per reservation status** (popup shows only these; invalid actions are hidden, not just disabled):

| Status | Available actions |
|---|---|
| Pending | Confirm (navigates to floor-plan eligibility flow per SPEC §6.5), Reject, Edit, Cancel |
| Confirmed | Edit, Cancel, Assign table (if tableId is null), Reassign table |
| AutoConfirmed | Edit, Cancel, Reassign table (Pick table initially if unassigned) |
| AwaitingGuest (derived) | Seat (mark arrived), No-show (with undo per 3.5), Cancel, Edit |
| Occupied | Complete (mark finished), Cancel (rare — refund-style edge case) |
| Completed | View only — no actions (historical record) |
| Cancelled | View only — no actions (historical record) |
| NoShow | View only — no actions (historical record) |
| ModificationPending | Tier D scope — Approve / Reject (deferred, not in C6) |

If reservation state changes via Socket.IO while popup is open, action buttons re-render to match the new state.

**Clarification on "AwaitingGuest" (added during C6 end-of-phase QA):** the row in the matrix above is a *derived* state, not a literal reservation status — `ReservationStatus` has no AWAITING_GUEST enum (that's only a table status per SPEC §9.1). In practice the reservation row is CONFIRMED / AUTO_CONFIRMED and the *table* flips to AWAITING_GUEST when its reservation time arrives without a seat. The popup's `isAwaitingGuestDerived` helper triggers the "AwaitingGuest" action set when ALL of:
- `reservation.status ∈ { CONFIRMED, AUTO_CONFIRMED }`
- `reservation.tableId` is set
- `reservation.seatedAt` is null
- EITHER `reservation.table.status === 'AWAITING_GUEST'` (Live + Calendar mount paths supply this) OR `reservation.secondsLate > 0` (Dashboard summary path supplies this).

When the derived state is true, Seat + No-show are added to the regular Edit + Cancel action set for that reservation. Without this fix, the no-show + seat buttons would never appear in practice — caught and fixed during the C6 end-of-phase shift QA.

**WHY.** Currently a waiter clicking a table in Live can't take action on the reservation from there — they navigate to Reservations. A single shared popup means the waiter never has to navigate between pages to act. This is the foundation that other C6 items build on.

**WHERE.** New shared component apps/restaurant/components/ReservationDetailPopup.jsx with sub-components for ActionButtonRow and ReservationInfo. Imported and instantiated by Reservations, Calendar, Live, Dashboard.

**CONNECTIONS.** Backend: same existing endpoints for each action (no new endpoints needed). Real-time (DEPENDS ON C4): popup subscribes to reservation:updated events for the open reservation so the displayed info stays current. i18n (DEPENDS ON C5): all labels, action button labels + subtext.

**VERIFICATION.** Click a reservation from each entry point (Reservations row, Calendar block, Live table, Dashboard list). Popup opens, shows correct data, allows actions. From another tab, modify the reservation — confirm the popup updates without close/reopen.

### 3.2 Quick Add Reservation, exposed everywhere (P0)

**WHAT.** A floating "+" action button visible on Dashboard, Live Floor Plan, Reservations, and Calendar. Position: floating bottom-right (thumb-reachable on tablet) on all viewports, plus keyboard shortcut **Alt+N** on desktop (Ctrl+N is reserved by Chrome for "New window" and cannot be reliably intercepted). Opens the modal from 3.3.

**WHY.** Phone-in is the most frequent flow. Currently the entry point only exists on Reservations. Always-accessible matches a notebook on the host stand.

**WHERE.** New shared component apps/restaurant/components/ui/QuickAddButton.jsx mounted in apps/restaurant/app/dashboard/layout.js so it appears on every dashboard page. Hidden on Settings.

**CONNECTIONS.** Backend API: no change (same POST). Schema: no change. Real-time (DEPENDS ON C4): on save broadcast new reservation. i18n (DEPENDS ON C5): button label.

**VERIFICATION.** From each of the four pages, click "+" or press Ctrl+N — modal opens. Save → propagates within 1s to all open clients.

### 3.3 Smart-defaulted Quick Add modal with pending-sync save (P0)

**WHAT.** Streamlined Create Manual Reservation form: auto-focus Name on open; default Date=today (or tomorrow if past closing), Time=next round 30-min slot in Europe/Bucharest, Party Size=2; visibly mark Phone and Special Requests as "(optional)"; collapsible "+ Add details" section for Phone+Requests (expanded by default); Tab order Name→Date→Time→Party→Phone→Special Requests→Save; Enter saves; Esc closes.

**Quick Add creates an UNASSIGNED reservation** (AutoConfirmed with tableId=null per SPEC §9.5). Table assignment happens separately via the floor-plan flow (existing SPEC §6.5) when the waiter or auto-confirm logic chooses one. This keeps Quick Add fast and avoids forcing the waiter to pick a table on a phone call.

**Live availability hint.** Below the form (above the Save button) display a small status line that updates as Date/Time/Party Size inputs change:
- "3 tables available at 20:00 for party of 4" (green / neutral)
- "1 table available — last one" (yellow caution)
- "No exact-fit tables free at this time — will need combining or override" (yellow caution, not red blocker)

Backed by a lightweight new endpoint `GET /api/restaurant/availability?date=Y-M-D&time=HH:mm&partySize=N` returning `{exactMatchCount, anyMatchCount, suggestionForCombining}`. Frontend debounces input changes by 300ms before querying. If endpoint is slow (>500ms) or unavailable, hide the hint silently — never block save. Hint is informational only; staff still has authority to save per SPEC §9.5 even when "no tables free."

**Save behavior is pending-sync, NOT optimistic:**
- On Save click → button shows spinner + label "Saving…", form locked.
- On 200 response → toast "Reservation saved" → modal closes.
- On error → modal stays open, inline error specifies the cause ("Conflict: table is booked at this time", "Invalid phone number", "Service period closed", etc.).

**WHY.** Reduces typical phone-in entry from ~7 interactions to ~2–4. Pending-sync prevents the waiter from telling the customer "you're booked" before the backend confirms.

**WHERE.** Shared apps/restaurant/components/QuickAddReservation.jsx, used by 3.2.

**CONNECTIONS.** Backend: same POST. Reservation.specialRequests already exists from Tier B. Real-time (DEPENDS ON C4): on success broadcast. i18n (DEPENDS ON C5).

**EDGE CASES.** Smart default Date must check the restaurant's `opening_hours` and `reservationDisabledDates` to find the **next open day**, not just "today or tomorrow." (Example: today is Monday, restaurant closed Mondays → default to Tuesday. Today is a configured holiday → default to next non-disabled day.) If no open day found in the next 14 days, default to next month's first day and let waiter pick. If current time is past last service slot of the next open day, default Time=first opening slot of that day. If keyboard auto-focus doesn't trigger virtual keyboard on tablet, add autocomplete='name'.

**Closed-hours manual entry.** If user manually selects a Date+Time combination that falls outside the restaurant's service periods (e.g., 02:00 on a normal day, or any time on a configured closed day), show a warning *before* Save: "20:00 is outside Lunch (11:00–15:00) and Dinner (18:00–23:00). Create anyway?" Yes/No. Default Yes on Enter, No on Esc. Doesn't block — gives staff agency for private events or off-hours bookings the manager has accepted. Distinct from the availability hint (which is about table fit at a valid time).

**VERIFICATION.** Cowork QA: open modal, type "Test Customer", press Enter. Saves with pending-sync feedback. Target: <10s end-to-end including server round-trip.

### 3.4 Walk-in fast seating (P0)

**WHAT.** When the waiter taps a Free (green) or Arriving-Soon (orange) table on Live floor plan, a small inline action sheet appears with: "Seat walk-in?" + party size stepper (default 2, +/- buttons, min 1, max party = table seat count or override) + optional "Add name" collapsible field. Tap "Seat" → table goes Red, walk-in record created (uses Tier B's TableActivity table), Dashboard active list updates, Live overlay shows party size.

**WHY.** Walk-ins are a top-5 flow during rush. Currently this is implied via "click Free table → mark as Taken" but the UX is undefined. Spelling it out: tap → party size → Seat. Three interactions max.

**WHERE.** apps/restaurant/app/dashboard/live/page.js — replace the current click-on-Free-table behavior with the action sheet flow. Backend: POST /api/restaurant/walkins (or use existing endpoint that writes to TableActivity).

**CONNECTIONS.** Backend (UPGRADE POSSIBLY NEEDED): confirm walkin creation endpoint exists; if not, add it. Schema: TableActivity already exists (Tier B). Real-time (DEPENDS ON C4): walkin:created event broadcasts. i18n (DEPENDS ON C5).

**EDGE CASES.** If walk-in party size > table seat count, show inline override option ("Party of 6 exceeds 4-seat table — seat anyway?"). If table is in Out-of-Service status, don't show the action sheet. If tapped table is **Orange (Arriving Soon)** AND the upcoming reservation is within 30 min, show warning before the action sheet: "T5 has a reservation in 12 min for Smith ×4 — seat walk-in anyway?" Yes/No. More than 30 min until reservation: no warning (probably fine for a quick seating).

**VERIFICATION.** Cowork QA: load Live as state-changing QA pass (dedicated test session). Tap a Free table, walk through the action sheet, confirm table goes Red and walk-in record persists.

### 3.5 No-show action with undo (P0)

**WHAT.** For reservations in Awaiting Guest status (the Light Red / Pink state), the Reservation Detail popup (3.1) and the Live floor plan table popup expose a "Mark no-show" button. Tapping it:
1. Sets reservation status to NoShow.
2. Frees the table (status → Free / Green).
3. Toast appears: "Marked no-show — Smith ×4. Undo" (10-second grace).
4. If undo tapped: status reverts to Awaiting Guest, table returns to its previous state.

No confirmation modal. Just action + undo toast.

**WHY.** Currently SPEC §8.1 says "Awaiting Guest → Free: manual (no-show)" but the UI doesn't distinguish freeing for no-show vs. cleaning up after a guest left. Making no-show a distinct action preserves the data (reservation marked NoShow) and is faster than navigating through two separate status changes.

**WHERE.** apps/restaurant/components/ReservationDetailPopup.jsx (the action button row). Also in Live floor plan's table popup. Backend: PUT /api/restaurant/reservations/:id/no-show.

**CONNECTIONS.** Backend (UPGRADE NEEDED): new endpoint for no-show transition. Real-time (DEPENDS ON C4): reservation:updated + table:status-changed events. i18n (DEPENDS ON C5).

**EDGE CASE — race with walk-in.** If staff marks no-show on T5 (table freed) and another staff seats a walk-in on T5 before the first staff taps Undo: the undo cannot cleanly restore Awaiting Guest because the table is now Occupied. Handle gracefully: undo verifies table state before reverting. If table state has changed, show error toast: "Cannot undo — table is now occupied by walk-in." Reservation stays in NoShow state. Real-world frequency: rare (10-sec window), document as expected behavior.

**VERIFICATION.** Cowork QA: simulate a reservation in Awaiting Guest, mark no-show via popup. Confirm status updates, table frees, undo toast appears. Tap undo within 10s — confirm reversion.

### 3.6 Pending reservation real-time alert (P0)

**WHAT.** When a new pending reservation arrives via the mobile app, the restaurant platform fires a global alert visible from any page: a toast (top-right corner) showing "New request: {guestName}, {date} {time}, party of {partySize} — Review", click-through to Reservations Pending tab focused on that row. A pending-confirmation badge increments immediately in the **persistent top-header element visible on ALL pages** (not just Dashboard). On desktop, an optional subtle audio chime fires once. Toast auto-dismisses after 8s but the badge persists in the header until all pending reservations are resolved.

**Persistent top header (cross-cutting):** the platform's existing top bar (currently showing "ApRez Restaurant Platform" with restaurant name) gets a badge slot for the pending count. Tapping the badge from any page navigates to Reservations Pending tab. This is the single source of "you have pending requests" visibility — waiter sees it whether they're on Live, Calendar, Dashboard, or Reservations.

**WHY.** Waiter is on the floor or in the kitchen, not staring at a screen. Without this alert, app reservations get missed for minutes.

**WHERE.** New shared toast system in dashboard layout. apps/restaurant/components/ui/PendingReservationToast.jsx. Audio chime asset in public/.

**CONNECTIONS.** Backend: no change. Real-time (DEPENDS ON C4): C4 must broadcast reservation:pending-created event to restaurant's room. Audio cue requires user gesture for autoplay (one-time prompt at first session login). i18n (DEPENDS ON C5).

**EDGE CASES.** If multiple pending arrive simultaneously, queue (max 3 visible, oldest first). Suppress toast if user is already on the Pending tab (still increment badge silently). **Audio toggle:** per-session toggle in Settings → "Audio alerts" (persists in localStorage). Default ON. When OFF, only visual toast fires.

**VERIFICATION.** Cowork QA: simulate diner request from another tab. Toast appears within 1s on Dashboard, Live, Calendar regardless of active page. Click navigates to Pending tab. Badge increments.

### 3.7 Live floor plan: name + party + time overlay (P0)

**WHAT.** Each occupied or booked table renders not just status, but: guest name (truncated to 12 chars + ellipsis if longer), party size (×N), reservation time, and special-request badge if applicable. For occupied: shows seated guest. For Arriving Soon / Awaiting Guest: shows upcoming reservation. Free tables unchanged. For Awaiting Guest >10min: shows "X min late" badge (see 3.13).

**WHY.** Floor map is the most-used view during service. Making it self-sufficient means eyes never leave the floor to identify guests.

**WHERE.** apps/restaurant/app/dashboard/live/page.js. Tighten typography but preserve ≥80px card height to leave room for Tier I drag-merge handles.

**CONNECTIONS.** Backend (UPGRADE NEEDED): amend tables-live endpoint to include currentReservation and nextReservation per table (guest name, party, time, specialRequests boolean, secondsLate when applicable). Schema: no change. Real-time (DEPENDS ON C4): table:status-changed + reservation:updated events. i18n (DEPENDS ON C5).

**EDGE CASES.** Long names truncated; full name visible in popup (3.1). Cards stay ≥80px tall.

**TIER I MERGED-CARD RENDER CONTRACT (added 2026-05-16, I2).** Merge groups render via a two-pass strategy in `apps/restaurant/app/dashboard/live/page.js`:
- **Pass 1a — rectangular merges**: when `members.length === rowSpan × colSpan`, render a single `<button>` spanning the bounding box via CSS `gridColumn: ${minC+1} / span ${colSpan}` + `gridRow: ${minR+1} / span ${rowSpan}`. Amber border + ★ + combined label.
- **Pass 1b — L-shape fallback**: when the members don't fill their bounding box, render per-member cards (one button per member) with the same amber border. Combined label on the topmost-leftmost member only. Avoids claiming a phantom corner cell.
- **Pass 2 — standalone + empty cells**: iterate the row-col grid as pre-Tier-I, but skip cells claimed in pass 1 (tracked in a `Set<"row,col">`). Standalone cards keep `min-h-[80px]` AND now also carry a small drag handle (⠿, ~14px) in the top-right corner.
- **Drag handle convention**: native HTML5 `draggable` on the handle span only (not the parent button) with `stopPropagation` on the click/mousedown handlers so the existing tap-to-popup gesture stays clean. Visible only on tables that pass the merge-eligibility client-side check (non-OCCUPIED, non-OUT_OF_SERVICE, not in confirm-mode).
- **80px height budget**: drag handle reuses the existing top-row chip space (next to seat count), so the budget holds. If future surface additions threaten it, defer them to the popup rather than crowding the card.
- **No two active merges share a cell** — server enforces via the merge-window-conflict 409. Client trusts.

Future tier work touching the Live page MUST preserve these invariants. The C6 popup-actions Node smoke covers the payload-keyed merge branch (scenarios J/J'/J''/J''') — extend that smoke rather than diverging.

**VERIFICATION.** Cowork QA: load Live, confirm overlay on Red and Pink tables shows name + party + time. Trigger status change from another tab — confirm overlay updates.

### 3.8 Dashboard rebuild as command center (P0)

**WHAT.** Replace three-numeric-tile layout with three operational zones: **NOW** (currently-active reservations + occupied tables), **NEXT** (upcoming 8 reservations chronological with "Show more" → 24), **SEARCH** (guest name / phone / email autocomplete with inline action buttons on each result). Header strip: current time HH:mm Europe/Bucharest, restaurant name. Right column: small stat tiles. All clickable reservations open the shared popup from 3.1.

Note: the **pending-confirmation badge lives in the global top header per 3.6** (visible across all pages), NOT in the Dashboard chrome. Dashboard's stat tiles can still show pending count as a number, but the alert badge is global.

**Preserve existing routes and auth gates.** This is a rewrite, not a re-architecture — sidebar nav, logout, profile access, role permissions remain identical.

**WHY.** Currently three numbers + nav cards — useless for "what's the night look like?". The Now / Next / Search structure mirrors how a waiter thinks during a shift.

**WHERE.** Major rewrite of apps/restaurant/app/dashboard/page.js. New components NowZone.jsx, NextZone.jsx, SearchZone.jsx. Tablet width 768–1280px primary target.

**CONNECTIONS.** Backend (UPGRADE NEEDED): new GET /api/restaurant/dashboard/summary returning {currentTime, nowReservations[], nextReservations[8], pendingConfirmationCount, todayCount, occupiedCount}. Guest search reuses or extends existing search endpoint with 300ms debounce. Real-time (DEPENDS ON C4): all reservation/table events. i18n (DEPENDS ON C5).

**EMPTY STATES.** Zero now / next reservations → "All quiet — enjoy the break" or similar friendly text. Zero pending → no badge.

**VERIFICATION.** Cowork QA: load Dashboard, confirm three zones, search autocomplete works. Trigger new reservation from another tab — confirm <1s update. Test at 1024px tablet width.

### 3.9 Edit existing reservation (P1)

**WHAT.** From the shared popup (3.1), an "Edit" button opens an inline edit mode (or a modal that reuses the Quick Add form with current values pre-populated). Editable: Date, Time, Party Size, Phone, Special Requests, assigned Table. Save uses pending-sync (per 3.3).

**WHY.** Customer calls to change their booking. Common flow, currently has no UI.

**WHERE.** apps/restaurant/components/ReservationDetailPopup.jsx — add Edit mode. Backend: PUT /api/restaurant/reservations/:id (likely exists; verify).

**CONNECTIONS.** Backend (CONFIRM): PUT endpoint exists or add. Real-time (DEPENDS ON C4): reservation:updated. i18n (DEPENDS ON C5).

**VERIFICATION.** Cowork QA: open a confirmed reservation in the popup, click Edit, change time, save. Confirm popup updates, Reservations table row updates, Calendar block moves.

### 3.10 Calendar: "now" indicator and click-empty-slot (P1)

**WHAT.** (a) when selectedDate === today, render a horizontal accent at current 15-min slot, repositioning every minute; (b) clicking an empty cell (no reservation, not out-of-service) opens Quick Add with table + time pre-filled.

**WHY.** "Now" orients waiters instantly. Click-empty-slot matches "I'll write 19:30 in T5's column" notebook behavior.

**WHERE.** apps/restaurant/app/dashboard/calendar/page.js. Now-indicator is a separate component re-rendering every minute (not the whole calendar).

**CONNECTIONS.** Real-time (USES C4 via 3.2's broadcast). i18n: no new strings.

**EDGE CASES.** Clicking out-of-service cell shows toast "Table is out of service" and does NOT open Quick Add. Clicking an occupied cell opens the existing reservation popup (3.1), not Quick Add.

**VERIFICATION.** Cowork QA: load Calendar today, confirm "now" highlight repositions. Click empty slot at T5/20:00 — Quick Add opens prefilled. Click OOS cell — rejected.

### 3.11 Action buttons with always-visible subtext (P1)

**WHAT.** Replace tooltip-on-hover with always-visible inline subtext for ambiguous action buttons only: Confirm ("approve booking"), Seat ("mark arrived"), Pick table ("assign table"), Complete ("mark finished"). For obvious buttons (Cancel, Reject, Save) no subtext needed — preserves space and consistency.

**WHY.** Tablets don't have hover. Always-visible subtext works everywhere. Selective application avoids cluttering buttons that don't need explanation.

**WHERE.** Shared apps/restaurant/components/ui/ActionButton.jsx. Used by 3.1, Reservations, Calendar popup, Live popup.

**CONNECTIONS.** No backend / schema / real-time. i18n (DEPENDS ON C5): subtext strings.

**VERIFICATION.** Cowork QA: confirm subtext on ambiguous buttons. Switch UI language to RO — confirm subtext translates.

### 3.12 Special Requests inline visibility (P1)

**WHAT.** When reservation.specialRequests is non-empty, render "✦" icon next to guest name in Reservations table, Calendar block popup header, Live overlay, Dashboard lists. Tap/hover reveals full text.

**WHY.** Pre-shift awareness and during-service awareness both improve.

**WHERE.** Shared SpecialRequestsBadge.jsx component.

**CONNECTIONS.** No backend / schema. i18n (DEPENDS ON C5): icon tooltip "(special request)".

**VERIFICATION.** Cowork QA: rows with specialRequests show badge; without don't. Hover/tap reveals full text.

### 3.13 Late-arrival state (P1)

**WHAT.** When a reservation is in Awaiting Guest status and more than 10 minutes have passed since reservation time, display "X min late" next to the guest entry on Live overlay (3.7), Calendar block, and Dashboard Now zone. Updates every minute.

**WHY.** Helps waiters decide whether to mark no-show or wait. "12 min late" is more actionable than just "Awaiting Guest."

**WHERE.** Shared utility for computing minutesLate from reservation.time and serverNow. Render in 3.1 popup + 3.7 overlay + 3.8 Dashboard.

**CONNECTIONS.** Backend (UPGRADE NEEDED): tables-live and dashboard-summary endpoints should include secondsLate per applicable reservation. Real-time (USES C4). i18n (DEPENDS ON C5): "X min late" / "X min întârziere".

**VERIFICATION.** Cowork QA: simulate Awaiting Guest reservation 12 min past time. Confirm "12 min late" displays correctly across views.

---

## 4. Operational reliability requirements (cross-cutting)

These apply to all C6 items and to all future restaurant-platform work.

### 4.1 Availability and conflict rules

The platform must respect these rules, surfaced as explicit error/warning text wherever an action could violate them:

- **Reservation duration: 120 minutes fixed** (per SPEC §9.2). No buffer between back-to-back bookings — boundary touches don't overlap.
- **Conflict detection:** any action that assigns or moves a reservation to a table must check overlap. If conflict: show specific error ("Table 5 is booked 19:00–21:00 by Smith ×4"), not generic message.
- **Combined tables affect availability:** when tables are combined (Tier I), both component tables show as occupied during the combined reservation.
- **Capacity override exists** (per SPEC §8.2) for party > table seats, but is not the normal flow. UI shows a warning before allowing.
- **Out-of-service tables** are excluded from all assignment, suggestion, and walk-in flows. Clicking shows "Table is out of service."
- **Past times are not bookable** for current-day reservations (SPEC §5.3: minimum 30 minutes from now for same-day).

These rules already exist in SPEC §8.1, §9.2, §9.3. C6's job is to make them visible to the waiter at the moment of action, not silently enforced.

### 4.2 Pending-sync save pattern (not optimistic)

For any action that creates or modifies reservation state (Save reservation, Edit reservation, Assign table, Mark no-show, Cancel, Confirm, Reject):

- Show "Saving…" / "Processing…" inline feedback during the request.
- Disable the action button while in flight.
- On 200: show success toast or close modal.
- On error: keep the form open, show specific error from backend response, allow retry.
- **Timeout:** after 10 seconds with no response, show "Connection lost. Retry?" with retry button. Don't leave the spinner indefinitely.

Never tell the waiter "saved" before the backend confirms.

### 4.3 Undo pattern for low-stakes destructive actions

For actions where the user is likely correct but mistakes happen:

- Action executes immediately (no confirmation modal).
- Toast appears with "Action done. Undo" + 10-second grace period.
- Undo reverts the state cleanly.

Applies to: No-show, Mark table free, Reject pending request, Complete reservation.

**One exception:** Cancelling a CONFIRMED reservation uses a brief confirmation modal ("Cancel this confirmed reservation for Smith ×4 at 19:30?" Yes/No). Why: a confirmed reservation has a customer expecting to arrive — undo doesn't protect if the waiter moves on without noticing the toast.

### 4.4 Socket reconnect + page-focus refetch

Socket.IO is primary for live updates. On these triggers, the client also refetches the current snapshot:
- Initial page load.
- Socket reconnection after a drop.
- Page becomes visible after being hidden (tab focus).

Visible indicator: when socket is disconnected, show a small "Reconnecting…" banner at the top of the page. When reconnected and refetched, banner clears.

Last-updated timestamp visible in Dashboard header strip ("Updated 14:32") gives the waiter a glance-confidence signal that data is fresh.

### 4.5 Responsive design — laptop, tablet, phone

The restaurant platform is primarily for tablets at the host stand, but laptops are used in the back office and phones are used by the manager when away. All flows must work across three viewport classes.

**Breakpoints to test:**
- 375px wide — phone portrait (iPhone SE class, smallest realistic phone)
- 768px — tablet portrait (iPad Mini, smaller Android tablets)
- 1024px — tablet landscape / small laptop
- 1440px — laptop / desktop

**Global rules (all viewports):**
- Touch targets minimum 44×44px (Apple HIG) or 48×48dp (Android).
- No hover-only interactions — every action must be reachable by tap.
- Button height minimum 48px.
- Body text 16px+ readable from arm's length.
- Avoid dense table layouts as primary interface — prefer cards/lists at tablet widths and below.
- Spacing: ≥16px between tap targets to prevent fat-finger errors.

**Phone-specific (375px–767px):**
- Shared Reservation Detail popup (3.1) becomes a **full-screen sheet** (slides up from bottom), not a centered modal — no wasted edge space.
- Quick Add modal (3.3) also full-screen sheet on phone.
- Floor plan grid: tables stack into a **single scrollable column** (one table per row) — the 2D grid layout doesn't fit on a phone width. Section tabs still work.
- Dashboard zones (Now / Next / Search) stack vertically, full width.
- Calendar grid: keep table rows × time columns but allow horizontal scroll (the timeline doesn't compress).
- Sidebar nav: collapse into a hamburger menu, expand on tap.
- Floating "+" button: bottom-right corner, accounting for any iOS home-indicator safe area.

**Tablet-specific (768px–1023px portrait, 1024px+ landscape):**
- Sidebar nav visible by default (collapsible).
- Floor plan grid renders as designed (2D table layout).
- Dashboard zones can sit side-by-side when wider than 1024px.
- Shared popup: centered modal, max-width 560px.

**Laptop/desktop (1024px+):**
- Full layout with sidebar, multi-column Dashboard.
- Alt+N keyboard shortcut for Quick Add active.

**Claude Code MUST verify each commit at all three viewport classes** during Phase 4 per-commit verification. Use browser DevTools device-emulation or Cowork's Chrome extension to test 375 / 768 / 1440 explicitly. Any item that looks broken at any breakpoint blocks the commit.

### 4.6 Bilingual-ready (i18n key structure)

Every new string in C6 must go through i18n keys, even if C5 (full translations) is still landing. Pattern:
- Keys live in i18n/keys.js or equivalent.
- Romanian translations are the primary target; English as fallback.
- C6 can ship with RO partially filled — the keys structure must be in place so C5 can fill the gaps without code edits.

This rule lets C5 and C6 partially parallelize if scheduling demands it.

---

## 5. Cross-cutting impact map

| Change | C4 (Socket.IO) | C5 (i18n) | Backend API | Schema | Existing flows |
|---|---|---|---|---|---|
| 3.1 Shared popup | depends on | depends on | none | none | foundation, used by 3.2-3.13 |
| 3.2 Quick Add everywhere | depends on | depends on | none | none | replaces existing modal trigger |
| 3.3 Quick Add modal | uses (via 3.2) | depends on | none | none | replaces existing form |
| 3.4 Walk-in seating | depends on | depends on | endpoint upgrade | uses TableActivity (Tier B) | replaces undefined behavior |
| 3.5 No-show + undo | depends on | depends on | endpoint upgrade | none | additive |
| 3.6 Pending alert | depends on | depends on | none | none | additive |
| 3.7 Live overlay | depends on | depends on | endpoint upgrade | none | additive |
| 3.8 Dashboard rebuild | depends on | depends on | new endpoint | none | full rewrite, preserves nav |
| 3.9 Edit reservation | depends on | depends on | verify PUT endpoint | none | additive |
| 3.10 Calendar now+slot | uses (via 3.2) | uses | none | none | additive |
| 3.11 Action subtext | none | depends on | none | none | additive |
| 3.12 Special requests inline | none | depends on | none | none | additive |
| 3.13 Late state | depends on | depends on | endpoint upgrade | none | additive |

**Backend changes required in C6:**
- New: GET /api/restaurant/dashboard/summary
- Upgrade: GET tables-live endpoint to include reservation summary per table + secondsLate
- Upgrade: walkin creation endpoint (verify or add)
- New: PUT /api/restaurant/reservations/:id/no-show
- Verify: PUT /api/restaurant/reservations/:id (for edit)

## 5a. Socket.IO events C4 must broadcast (forward-looking constraint on C4)

When C4 is approved, ensure its prompt includes broadcasting these events to restaurant:{restaurantId} room:

- **reservation:created** — new reservation (app or staff-created). Payload: full reservation.
- **reservation:pending-created** — subset of above where status=Pending and source=App. Used by 3.6 alert.
- **reservation:updated** — status/table/time/party changes. Payload: updated reservation.
- **reservation:cancelled** — Cancelled state.
- **table:status-changed** — table status transition. Payload: tableId, newStatus, optional currentReservation.
- **walkin:created** — walk-in logged. Payload: tableId, partySize, startedAt.
- **walkin:ended** — walk-in cleared (table freed). Payload: tableId.

C4 client must also implement: socket reconnection handler, page-visibility-change handler, both triggering a refetch of the current page's data. Visible "Reconnecting…" banner during disconnect.

## 5b. Real-time freshness model

Socket.IO primary. Client refetch triggers: initial load, socket reconnect, tab focus. Client-side intervals handle only: (a) dashboard current-time display (30s), (b) Calendar "now" indicator (60s), (c) late-arrival "X min late" computation (60s).

---

## 6. Updated tier order

```
A → B → C1 → C2 → C3 → C4 → C5 → C6 → D+E+F+I (parallel) → G+H → J
```

**Strict dependency by default:** C6 cannot start until C5 is complete. EXCEPTION per rule 4.6: if C5 is mostly done but has gaps, C6 may proceed using i18n key structure with partial RO translations — C5 fills the rest in parallel.

**Why C6 sits before D+E+F+I:** Tier D adds new flows (modification UI on mobile + restaurant, account deletion, forgot-password). Those inherit C6 patterns (Quick Add modal, shared popup, action button subtext, undo pattern). Doing C6 first ensures consistency.

Tier J absorbs everything deferred from C6.

---

## 7. Out of scope for C6 (defer to J or beyond)

Tracked in SPEC.md §15 but not in C6 scope:
- Service period filter (Lunch / Dinner) on Calendar and Live.
- Notification feed page (separate from real-time toast).
- Ban-client search on Dashboard (low frequency).
- Custom grid dimensions per restaurant in admin.
- Photos / Menu PDF upload in admin.
- Mobile diner UX polish.
- Multi-staff edit-conflict indicator.
- Offline mode beyond reconnect/refetch.
- Onboarding tour for new waiters.
- End-of-shift sanity dashboard (unresolved pending, lingering occupied tables).
- Advanced reservation modification approval flow (depends on Tier D mobile UI).

If C6 lands ahead of schedule, items above can be pulled in.

---

## 8. Coding process — phased execution

C6 does NOT ship as one large rewrite. Five phases, each with checkpoints. Each commit is small and reviewed by Cowork QA pass before the next starts.

### Phase 1: Lock data contracts
Before any UI:
- Define dashboard-summary endpoint shape.
- Amend tables-live endpoint shape (add reservation summary + secondsLate).
- Define no-show endpoint contract.
- Define walkin creation endpoint contract.
- Document all Socket.IO event payloads (matching §5a).
- Verify availability/conflict rules from §4.1 are implementable as backend validation.

**Performance budgets (must verify before Phase 2 starts):**
- GET /api/restaurant/dashboard/summary → p95 < 500ms
- GET tables-live endpoint → p95 < 300ms
- GET /api/restaurant/availability (new, used by Quick Add live hint) → p95 < 200ms — called repeatedly on form input, must be fast and cacheable
- PUT no-show / walkin / edit endpoints → p95 < 400ms
- All other reservation actions → p95 < 400ms

If any endpoint exceeds budget, optimize (indexes, query refactor, caching) before Phase 2. Real-world: a Dashboard that takes 2s to load feels broken regardless of UI polish.

Single commit: "feat(api): C6 data contracts — endpoints, event payloads, performance budgets."

### Phase 2: Build shared infrastructure
Before any feature:
- Global toast/notification provider (used by 3.6, 3.5, undo pattern).
- Socket.IO client handler with reconnect/refetch.
- Shared ReservationDetailPopup component (3.1).
- Shared ActionButton component with subtext support (3.11).
- Quick Add modal component (3.2/3.3) — reusable.
- "Reconnecting…" banner component.

Multiple commits, one per shared component.

### Phase 3: Implement waiter flows in fastest-first order
1. Quick Add everywhere (3.2 + 3.3).
2. Pending reservation alert (3.6).
3. Live floor overlay (3.7).
4. Walk-in seating (3.4).
5. No-show with undo (3.5).
6. Edit existing reservation (3.9).
7. Dashboard rebuild (3.8) — last because largest and lowest per-shift frequency.
8. Calendar improvements (3.10).
9. Special request badges + action subtext + late-arrival display (3.11 / 3.12 / 3.13).

One commit per item. Each verified before the next begins.

### Phase 4: Per-commit verification
For each commit, Claude Code returns:
- changed files
- behavior added
- how it was tested
- **viewport verification at 375px / 768px / 1440px** (per §4.5) — explicit screenshots or curl-grep evidence
- known risks
- what remains

Sebastian + Cowork review behavior, not code.

### Phase 5: End-to-end shift QA
After all commits land. Cowork drives the browser via the extension to simulate a waiter shift on a seeded test restaurant:
- 20 reservations today (mixed statuses, some with special requests)
- 5 pending
- 3 special requests
- 2 late arrivals (one >15 min)
- 1 no-show
- 1 out-of-service table
- 1 walk-in already logged
- 1 overlapping reservation conflict

Then test each scenario from §2:
- Pre-shift Dashboard scan.
- Phone-in via Quick Add from each page (target <10s).
- App reservation alert + confirm flow.
- Walk-in fast seating.
- Mark no-show + undo.
- Edit existing reservation.
- Status updates from Live.
- Socket update visible from another tab.

If anything feels slower than a notebook, the relevant commit is revisited before C6 is declared done.
