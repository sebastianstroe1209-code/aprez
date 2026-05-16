# ApRez — Product Specification (canonical)

> **This is the single source of truth for ApRez product behavior.** Every feature, flow, and edge case is documented here. When this file and the code disagree, the code is wrong unless `## Decisions log` records an explicit override. When this file and `ApRez FULL DOC MVP1.docx` disagree, **this file wins** — the docx is a snapshot of v1 thinking; this file integrates all decisions made since.
>
> **Editing rules:** Any change to product behavior gets reflected here in the same commit. Add an entry to `## Decisions log` with date, decision, and rationale. Don't silently change behavior without updating this file.
>
> **Last updated:** 2026-04-30

---

## Table of contents

1. Product overview
2. Platforms
3. User onboarding & accounts
4. Restaurant onboarding
5. Client app (mobile, diner-facing)
6. Restaurant platform (web, staff-facing)
7. Admin tool (web, ApRez team)
8. Table system
9. Reservation system
10. Notification system
11. Language & localization
12. Technical edge cases
13. Definition of Done
14. Decisions log
15. Known gaps & bugs to fix

> **Sections 10 (Waitlist) and 12 (Billing Model) of the original docx are cut from MVP.** They are not in this spec. Any code referencing them is to be removed.

---

## 1. Product overview

ApRez is a restaurant reservation platform for Romania. It digitizes the reservation process, replacing phone calls (for diners) and paper tracking (for restaurants) with a modern app and web platform.

Two-sided marketplace:
- **Diners** discover restaurants and make reservations via a mobile app.
- **Restaurants** manage reservations, table layouts, and operations via a web platform.
- **The ApRez team** onboards restaurants and manages the system via an internal admin tool.

**Revenue model.** Diners pay their restaurant bill + a 1 RON per person ApRez fee, all on one bill paid to the restaurant. ApRez bills restaurants monthly to collect the accumulated fees. **For MVP, Sebastian handles billing manually outside the platform.** No billing UI in the admin tool.

---

## 2. Platforms

| Platform | Type | Users |
|---|---|---|
| Client App | Mobile app (iOS + Android via Expo) | Diners |
| Restaurant Platform | Web (tablet/desktop optimized, port 3001 in dev) | Restaurant staff |
| Admin Tool | Web (internal, port 3002 in dev) | ApRez team |

Backend: Node + Express + Prisma + Socket.IO. PostgreSQL on Railway. Port 4000 in dev.

---

## 3. User onboarding & accounts

### 3.1 Diner registration
- User downloads the app, signs up with **email + password**.
- Required fields: first name, last name, email, password.
- Optional fields: phone number (`+40...` format only). **Phone is not verified for MVP** — collected for SMS fallback notifications only.
- Location obtained automatically from phone GPS after sign-up (used for restaurant proximity sort).

### 3.2 User profile data
- Name (first + last)
- Email (primary identifier, required)
- Phone number (optional, unverified)
- Location (GPS-based, refreshed periodically)
- Reservation history (30-day rolling window — older reservations are pruned)
- Favorite restaurants
- Active reservations
- Preferred language (`ro` default, `en` available)

### 3.3 Authentication
- **Email + password** for diners and restaurant staff.
- Session persistence via JWT (stay logged in until logout).
- **Forgot password:** self-serve email reset link, available to both diners and restaurant staff.
- **Account deletion (diner only):** GDPR-compliant "Delete my account" action in profile that erases personal data (name, email, phone, location, reservation history). Permanent.

### 3.4 Auth out of scope for MVP
- Phone OTP (SMS or WhatsApp) — deferred to MVP+1.
- Social login (Google, Apple) — deferred.
- Multi-factor auth — deferred.

---

## 4. Restaurant onboarding

Restaurants do **not** self-register. Workflow:

1. ApRez team physically visits the restaurant and pitches the platform.
2. Restaurant agrees and provides all profile details via email (name, photos, menu PDF, description, opening hours, etc.).
3. ApRez team creates the restaurant profile using the admin tool.
4. ApRez team generates login credentials (username + password) for the restaurant.
5. ApRez team sends credentials to the restaurant (email or in-person).
6. Restaurant staff logs into the restaurant platform with those credentials.
7. Restaurant is live and can receive reservations.

For MVP, credential delivery is manual. Post-MVP improvement: admin tool emails credentials automatically.

---

## 5. Client app — full specification

### 5.1 Home screen
- List of restaurants, sorted by proximity (using phone GPS).
- Search bar at the top.
- Filter options: cuisine type, location, party size, date, time.
- **Flexible filtering:** any combination of filters works (e.g., just cuisine, or cuisine + time + party size, or all filters at once).
- Only restaurants with availability matching the filters are shown (if reservation filters are applied).
- Restaurants that are closed for the selected day, or have reservations disabled for that date, are not shown.

### 5.2 Restaurant profile page
When a user taps a restaurant, they see:
- Cover photo + photo gallery (swipeable)
- Restaurant name
- Cuisine type(s)
- Description
- Address + map (Google Maps embed)
- Opening hours (per day, with closed days)
- Menu (PDF viewer, uploaded by admin)
- Phone number (tap to call)
- "Make a Reservation" button
- "Add to Favorites" button

**Cut from MVP:** Google Maps reviews integration.

### 5.3 Making a reservation

User taps "Make a Reservation". User selects:
- **Date** (calendar picker, today or future — minimum 30 minutes from now for same-day)
- **Time** (scrollable slots at 15-minute intervals, only within restaurant's service periods)
- **Party size** (1–30, using +/- buttons)
- **Special requests** (optional free-text field; visible to staff). Examples: "anniversary", "window seat preferred", "allergic to peanuts".

System checks availability:

- **If available AND auto-confirm conditions are met** (see §9.3): reservation is instantly confirmed. User sees: "Your reservation is confirmed! [Restaurant], [Date] at [Time] for [X] people."
- **If available BUT requires manual confirmation** (see §9.4): reservation request is sent. User sees: "Your reservation request has been sent! The restaurant will confirm shortly."
- **If NOT available:** user sees: "No tables available at [time] for [X] people." Below: "Next available: [time]" if a later slot exists that day. **No "join waitlist" option** — waitlist is cut from MVP.

### 5.4 My reservations
- All active reservations.
- Past reservations (30-day rolling history; older are pruned).
- Each reservation displays: restaurant name, date, time, party size, status, special requests (if any).
- **Statuses visible to user:**
  - **Confirmed** — reservation is confirmed (auto or manual).
  - **Pending** — waiting for restaurant to confirm.
  - **Modification Pending** — user requested a change, waiting for staff.
  - **Cancelled** — reservation was cancelled.
  - **Completed** — diner has already visited (status set automatically after the reservation's end time + the 120-min duration window).
- "Waitlisted" status removed (waitlist is cut).

### 5.5 Cancellation
- User can cancel any reservation at any time (no deadline for MVP).
- Simple "Cancel Reservation" button on the reservation detail screen.
- Confirmation prompt: "Are you sure you want to cancel?"
- Both user and restaurant receive notification upon cancellation.

### 5.6 Modification
- User can request changes to: time, date, party size, special requests.
- **All modifications require staff approval, regardless of direction.** No auto-approve path. (This overrides the original docx, which only required approval for upgrades.)
- Original reservation stays active while modification is pending.
- If staff approves: reservation is updated, user is notified.
- If staff rejects: user sees "Your modification was not approved. Would you like to keep your original reservation? [Keep] [Cancel]".

### 5.7 45-minute reminder
- 45 minutes before reservation time, user receives a push notification: "Your reservation at [Restaurant] is in 45 minutes. Will you make it? [Yes, I'll be there] [No, cancel]"
- If user taps "No": reservation is cancelled, restaurant is notified.
- If user taps "Yes" or doesn't respond: reservation stays active.
- Channel: push primary; SMS fallback only if push unavailable (see §10).

### 5.8 Favorites
- User can favorite/unfavorite restaurants from the restaurant profile page.
- Favorited restaurants appear in a "Favorites" tab.

### 5.9 Account deletion (GDPR)
- Profile screen has a "Delete my account" action.
- Confirmation prompt with explicit warning that the action is permanent.
- On confirm: backend deletes user PII (name, email, phone, location, reservation history). Past reservation rows in the DB are anonymized (kept for restaurant records but with PII redacted).
- User is logged out and the app returns to the login screen.

---

## 6. Restaurant platform — full specification

### Access
- Web-based platform, optimized for tablets and desktop browsers.
- Login with credentials provided by the ApRez team (username + password).
- **Real-time sync across devices:** if two staff are logged in on different devices, all changes are reflected instantly on both. No user-presence indicators (no "Alice is editing" cursors). Conflict resolution: **last-write-wins** — both clients reflect server state, no conflict UI.

### 6.1 Pages overview
- Home / Dashboard
- Restaurant Layout (with LIVE mode)
- Calendar
- Reservations
- Manage Profile
- *(Waitlists page is cut from MVP — removed from sidebar)*

### 6.2 Home / dashboard
- Overview of today's activity: upcoming reservations, current table statuses.
- Quick navigation to all pages.
- "Add Reservation" button (for phone-in reservations — staff creates the reservation manually). See §9.5.
- "Cancel Reservation" search.
- "Ban Client" — search by name, phone, or email. Banned client always sees the restaurant as fully booked. **No notification sent to the user.**
- "View Banned Clients" — list of banned users with option to unban.
- Search reservation by: user name, phone number, email, time, or party size. Shows full reservation details.
- Notification feed: cancelled reservations, new reservation requests, modification requests.

### 6.3 Restaurant layout (floor plan)
The main visual management page. Shows the floor map of the restaurant as an interactive grid.

**Section filter:** toggle between restaurant sections (Interior, Terrace, Private Room — as configured per restaurant in admin tool). Each section has its own grid layout. Grid dimensions are configurable per section (see §7.2).

**Time period filter:** toggle between service periods (e.g., "Lunch: 11:00–15:00", "Dinner: 18:00–23:00").

**Table grid:** each table shows table number (T1, T2…), seat count, current status color. Visual size reflects seat count (larger tables appear bigger). Abstract style; visually clean.

**Clicking a table (non-LIVE mode):** pop-up shows all reservations for that table today. Each reservation shows guest name, party size, reservation time, phone (tap to call), status. Options: Cancel reservation, Contact client (call).

**LIVE mode** (toggled by clicking a "LIVE" button):
- Real-time current status of all tables.
- Staff can change table statuses (see §8.1).
- Staff can move tables (see §8.2).
- Staff can cancel reservations.
- Primary view for managing walk-in guests — staff looks here to decide if they can seat someone.

**Walk-in handling in LIVE mode:**
- Staff clicks on a GREEN or ORANGE table.
- Marks it as "Taken" (turns RED).
- Prompt appears for guest count (default 2, +/- buttons, minimum 1).
- Same guest-count adjustment available for reservations if actual party size differs from booking.

**Floor-plan-driven confirmation:** when staff clicks "Confirm" on a Pending reservation from §6.5, they are navigated to this Layout view in confirmation mode. Eligible tables (sufficient seats AND no time-overlap conflict) are highlighted in primary color; ineligible tables are dimmed and click-disabled. Clicking an eligible table assigns it and confirms the reservation.

### 6.4 Calendar
- Displays **all table activity** across the selected date — not just reservations.
- Layout: rows = tables (with seat count), columns = time slots (scrollable across the full service period).
- Filter by section and service period.
- Date selectable, defaults to today.
- **Activity types shown as colored blocks on the timeline:**
  - **Reservations** (Pending, Confirmed, AutoConfirmed) — colored block spanning the 120-minute duration starting at the booked time.
  - **Walk-in occupations** — colored block starting when staff marked the table Occupied, ending when staff marked it Free (or +120 min if still occupied at the time the calendar is rendered).
  - **Out-of-service blocks** — grey block spanning the period the table was offline.
  - **Currently occupied** state (today only): the block representing the current occupation extends from start time to "now".
- A table that is currently Occupied shows the active block on today's calendar with a "live" indicator.
- Clicking a reservation block: pop-up with guest details, options to change/delete (with confirmation).
- Clicking a walk-in or out-of-service block: pop-up with timestamps and party-size (for walk-ins).
- Reservations can be confirmed from this view (not just from Layout LIVE).
- Staff can tap an empty slot to create a new reservation directly.
- Number of seats per table is editable from here (admin-only via this affordance).
- **Early arrivals:** if someone comes 10 minutes early, staff can seat them via LIVE mode. Table goes RED. Calendar shows the actual seating timestamp (not the original booked time) for the live segment; the original booked time is preserved as the reservation's record.
- **Past activity (earlier today and prior days):** all walk-ins, reservations, and OOS periods remain visible for historical context.

### 6.5 Reservations page
Where staff confirms or rejects incoming reservation requests **from diners**. Staff-created reservations (§9.5) are auto-confirmed and do **not** appear here as Pending.

- Shows all incoming Pending reservations in the order received.
- Each entry shows guest name, party size, requested date/time, status, special requests (if any).
- Auto-confirmed reservations appear separately (or with a distinct "Auto-confirmed" label) — staff can still reassign tables or cancel.

**Manual confirmation flow:**
1. Staff clicks "Confirm" on a Pending row.
2. Platform navigates to the Layout page in confirmation mode (see §6.3).
3. Eligible tables are highlighted; ineligible are dimmed.
4. Staff clicks an eligible table.
5. Backend assigns and confirms.
6. User receives notification.

**Reject:** staff clicks "Reject"; user receives notification "Sorry, [Restaurant] isn't available at [Time]. Try a different time."

**Modification requests** appear as special entries: "[Guest Name] requests to change: [field] from [old] to [new]". Staff can approve or reject. All modifications require staff approval (see §5.6).

### 6.6 ~~Waitlists page~~ — CUT FROM MVP

### 6.7 Manage profile
Restaurant staff can edit:
- Restaurant description (RO + EN)
- Photos (cover + gallery, JPG/PNG)
- Menu (PDF upload)
- Opening hours
- Contact details
- Auto-confirm toggle (defaults to ON; can be turned OFF to send all reservations through manual review)

Changes reflect immediately on diner app and across staff devices.

### 6.8 Forgot password
- Login screen has "Forgot password?" link.
- User enters their staff username or email.
- System sends a reset link to the email on file (set by admin during account creation).
- Reset link is valid for 1 hour, single-use.
- After reset, user logs in with new password.

---

## 7. Admin tool — full specification

Internal web platform for the ApRez team only.

### 7.1 Restaurant management

**Create restaurant profile — fields required:**
- Restaurant name
- Description (Romanian + English)
- Cuisine type(s) — multi-select (Romanian, Italian, Asian, French, Mediterranean, etc.)
- Address + Google Maps pin
- Phone number(s)
- Email
- Website (optional)
- Opening hours per day (Monday–Sunday, with ability to mark days as closed)
- Service periods per restaurant (e.g., "Lunch: 11:00–15:00", "Dinner: 18:00–23:00")
- **Days where reservations are disabled** (specific dates for holidays, private events)
- **Photos — cover photo + gallery (JPG/PNG, 5–10 images)** — upload UI required
- **Menu — PDF upload** — upload UI required
- Maximum party size (default: 30)
- Reservation duration (fixed at 120 minutes for MVP — read-only field)
- Auto-confirm toggle (ON/OFF, default: ON)
- Auto-confirm max party size (fixed at 4 for MVP — read-only field)
- Auto-confirm lead time (fixed at 24 hours for MVP — read-only field)

All text content entered in **both Romanian and English**.

**Edit restaurant profile:** all fields editable after creation. Changes reflect immediately on diner app and restaurant platform.

**Deactivate / reactivate restaurant:** deactivated restaurants don't appear in the diner app. Data is preserved. Can be reactivated at any time.

### 7.2 Table layout builder (per restaurant, per section)

**Create floor sections:**
- Name each section (e.g., "Interior", "Terrace", "Private Room").
- Each section gets its own grid.
- **Delete a section** — admin must be able to remove a section entirely. Confirmation prompt warns that all tables in the section will be deleted. If any reservations are tied to those tables, the deletion is blocked with a clear error and a count of affected reservations.

**Grid editor (per section):**
- **Define grid size (rows × columns) per section.** Restaurants vary — some are square, some long rectangles, some L-shaped (use multiple sections). Admin must be able to set arbitrary dimensions and to **resize an existing grid** (with a confirmation if shrinking would orphan tables).
- Place tables by clicking on grid squares.
- Each table has: table number (auto-assigned T1, T2…, editable), seat count (default 2, adjustable), visual size reflects seat count.
- Remove tables from the grid.
- Preview the layout as restaurant staff would see it.

**Table properties:**
- Table number
- Seat count
- Grid position (row, column)
- Section assignment
- Default status: Active (can be set to Out of Service, see §8.1)

### 7.3 Restaurant account management

**Login credentials:**
- When a restaurant profile is created, admin generates login credentials (username + password).
- Option to reset password for any restaurant (manually generated reset link or new password).
- Credentials sent to the restaurant by the ApRez team (email or in-person).

**Access control:**
- Admin tool accessible only to ApRez team members.
- Multiple team members can have admin access.
- Basic access log: who created/edited what, and when.

### 7.4 ~~Analytics & insights~~ — CUT FROM MVP

### 7.5 ~~Billing support~~ — CUT FROM MVP

### 7.6 Settings
- Manage admin team accounts (add/remove team members).
- Default configuration values (reservation duration, max party size, etc.) — read-only for MVP since they're fixed.

---

## 8. Table system

### 8.1 Table statuses

Five statuses, color-coded:

| Status | Color | Meaning |
|---|---|---|
| Free | Green (`#22c55e`) | No one is sitting; table is available. |
| Occupied | Red (`#ef4444`) | Clients are seated and dining. |
| Arriving Soon | Orange (`#f97316`) | Reservation incoming within 1 hour (informational). |
| Awaiting Guest | Light Red / Pink (`#ec4899`) | Reservation time has arrived but guest hasn't checked in. |
| Out of Service | Grey (`#6b7280`) | Restaurant has taken this table offline. |

**Status transitions:**
- Green → Orange: automatic (1 hour before a reservation).
- Orange → Awaiting Guest: automatic (at reservation time, if guest hasn't been seated).
- Awaiting Guest → Occupied: manual (staff marks as Taken when guest arrives).
- Occupied → Free: manual (staff marks as Free when guests leave).
- Any → Out of Service: manual.
- Out of Service → Free: manual (restore).

**Awaiting Guest reminders:** while a table is in Awaiting Guest, staff receives a prominent in-app notification every 15 minutes ("Guest for [Time] reservation hasn't arrived"). Stays Awaiting Guest until staff manually flips to Occupied (guest arrived) or Free (no-show).

**120-minute timer:** once a table turns Occupied, a 120-minute timer starts. When it expires, staff receives a prominent notification on the table in the layout view, urging them to clear it. Prevents tables from being blocked all day. Fixed at 120 minutes for MVP.

**Seating / assignment eligibility (rule, IN MVP):** all paths that put a reservation onto a table must respect the table's current status:
- The Seat action (`PUT /reservations/:id/seat`) rejects with 409 if `table.status IN ('Occupied', 'OutOfService')`.
- The eligible-tables endpoint (`GET /reservations/:id/eligible-tables`, called during the floor-plan confirm flow) excludes tables whose current `table.status IN ('Occupied', 'OutOfService')`, in addition to the existing time-overlap exclusion.
- The auto-confirm logic (§9.3) skips tables whose current `table.status IN ('Occupied', 'OutOfService')` even if no future reservation conflict exists.
- The assign-table endpoint (`PUT /reservations/:id/assign-table`) rejects with 409 if the target table is currently Occupied or OutOfService.
- This applies to every flow: auto-confirm, manual confirm, staff-create + assign, and re-assignment.

### 8.2 Table moving / combining

**This is in MVP scope. Section §8.2 of the docx applies.**

Tables can be physically moved on the grid to accommodate larger parties.

**How it works (in LIVE mode):**
- Staff drags a table to an adjacent square (up/down/left/right — not diagonal).
- Adjacent tables are automatically combined.
- Combined tables: name becomes "T1+T3" (component tables listed); seat count = sum of all combined tables.
- Up to 4 tables can be merged together.
- Tables can only be merged if directly adjacent on the grid after moving.

**Time-specific:**
- Moved tables only appear moved for that specific time block / reservation.
- They do not affect the layout for the rest of the day.
- Tapping on a moved table shows an option to move it back to its original position.
- The system memorizes original positions.

**Reservation logic:**
- A party of 10 cannot be assigned to a table of 7 (unless staff taps "override").
- Staff can move a table of 3 next to a table of 7 → combined table of 10 → assign the reservation.
- Override option exists as a safety valve but is not the normal flow.

---

## 9. Reservation system

### 9.1 Reservation data
Each reservation stores:
- Guest: name, phone number, email
- Restaurant ID
- Date (stored as `YYYY-MM-DD` in Europe/Bucharest TZ)
- Time (15-minute intervals, stored as `HH:mm` in 24-hour format)
- Party size (1–30)
- Special requests (optional free-text, see §5.3)
- Assigned table (or null if pending and not yet assigned, or AUTO_CONFIRMED with no table per §9.5 limbo state)
- Status: `Pending`, `Confirmed`, `AutoConfirmed`, `ModificationPending`, `Cancelled`, `Completed`, `NoShow`
- Source: `App` (diner booked) or `Manual` (staff created)
- Creation timestamp (UTC, displayed in Europe/Bucharest)
- `seatedAt` timestamp (null until staff seats; set when status moves to Occupied)
- `actualPartySize` (set when staff seats; defaults to booking's party size)

### 9.2 Reservation duration
- Fixed at 120 minutes for MVP.
- When a reservation is booked for 19:00, the table is blocked from 19:00 to 21:00.
- The next reservation at the same table can start at 21:00 or later (boundary touches but doesn't overlap; no buffer).
- If the table is freed early (guest leaves), staff marks Free; remaining blocked time is released.

### 9.3 Auto-confirm logic

A reservation is auto-confirmed when **ALL** of these are true:
1. Reservation is **more than 24 hours away** (lead time).
2. **Party size ≤ 4** (auto-confirm cap).
3. A single table exists with **seat count exactly equal to party size** AND no time-overlap conflict.
4. Restaurant has auto-confirm toggle ON (default ON).

When auto-confirmed:
- System assigns the matching table (if multiple match exactly, pick one with the most free neighbors for combining flexibility).
- User receives instant confirmation.
- Reservation appears on restaurant platform as "Auto-confirmed". Staff can reassign or cancel at any time.

### 9.4 Manual confirm logic

Triggered when **any** of these are true:
- Reservation is less than 24 hours away.
- Party size > 4 (above auto-confirm cap).
- No single table with exact seat count is available (e.g., party of 5 and only 6-seat tables exist; combining might be needed).
- Restaurant has auto-confirm OFF.

Flow: see §6.5 (Reservations Page).

### 9.5 Staff-created reservations

For people who still call to make reservations:
- Staff clicks "Add Reservation" on the dashboard or taps an empty slot on the calendar.
- Enters: guest name, phone (optional), party size, date, time, special requests (optional).
- **Reservation is created with status `AutoConfirmed` regardless of whether a table is assigned at create time.** Staff-created reservations bypass the manual-confirm flow because staff have already validated the booking on the phone.
- Source: `Manual`.
- These count toward billing (post-MVP).

**In-limbo state:** if staff creates the reservation without picking a table, status is `AutoConfirmed` and `tableId = null`. The reservation appears on the Reservations page (and/or on the Calendar) marked as "[unassigned]". Staff can click "Pick table" to navigate to the floor plan and assign one.

---

## 10. Notification system

> SMS is treated as a fallback channel, not a primary. Restaurant-facing notifications never use SMS. Diner-facing rules vary per event.

### Per-event channel rules

| # | Event | Recipient | Channels |
|---|---|---|---|
| 1 | Reservation auto-confirmed | Diner | **Push only** — diner is in-app at booking moment; in-app screen + push is enough |
| 2 | Reservation manually confirmed | Diner | **Push primary, SMS fallback** — SMS only if user has no FCM token or push disabled |
| 3 | Reservation rejected | Diner | **Push primary, SMS fallback** |
| 4 | Reservation cancelled BY restaurant | Diner | **Push + SMS, both, every send** — high stakes; can't risk diner showing up |
| 5 | Modification approved | Diner | **Push only** — good news, not time-critical |
| 6 | Modification rejected | Diner | **Push primary, SMS fallback** — diner needs to keep-or-cancel |
| 7 | 45-minute reminder | Diner | **Push primary, SMS fallback** — most critical; restaurant prep on the line |
| 8 | New reservation request | Restaurant | Push + In-app, **never SMS** |
| 9 | Reservation cancelled by diner | Restaurant | Push + In-app, **never SMS** |
| 10 | Modification requested | Restaurant | Push + In-app, **never SMS** |
| 11 | 120-minute table timer expired | Restaurant | In-app only (prominent alert on the table visual) |
| 12 | Awaiting Guest 15-min reminder | Restaurant | In-app only (recurring alert every 15 min) |

### Implementation

```
hasPush = user.fcmToken IS NOT NULL AND user.pushEnabled = true
hasPhone = user.phone IS NOT NULL

case #4 (restaurant cancellation):
    if hasPush: send push
    if hasPhone: send SMS
    # at least one fires if user gave us either

cases #1, #5 (push-only events):
    if hasPush: send push
    # no SMS ever

cases #2, #3, #6, #7 (push primary, SMS fallback):
    if hasPush: send push
    elif hasPhone: send SMS
    # never both
```

Phone is optional per §3.1, so a small percentage of users will be push-only across the board. Acceptable for MVP. Post-first-reservation phone-collection prompt shipped in Tier D commit 2 (soft prompt on the booking confirmation screen, dismissal persisted via `User.phonePromptSeenAt` so it never re-fires).

### Notification content (templates)

- Auto-confirmed: "Your reservation at {restaurant} is confirmed! {date} at {time} for {partySize} people."
- Manually confirmed: "Your reservation at {restaurant} has been confirmed! {date} at {time}."
- Rejected: "Sorry, {restaurant} isn't available at {time}. Try a different time."
- Cancelled by restaurant: "Your reservation at {restaurant} for {date} at {time} has been cancelled by the restaurant."
- 45-min reminder: "Your reservation at {restaurant} is in 45 minutes. Will you make it?" with [Yes, I'll be there] / [No, cancel] action buttons.
- Modification approved: "Your reservation change has been approved! New details: {summary}."
- Modification rejected: "Your modification wasn't approved. Would you like to keep your original reservation?" with [Keep] / [Cancel].
- New reservation (restaurant): "New reservation request: {guestName}, {date} at {time}, party of {partySize}."
- Cancelled by diner (restaurant): "{guestName} cancelled their reservation for {date} at {time}."
- Modification requested (restaurant): "{guestName} requests to change their reservation: {details}."

All templates exist in both Romanian and English (see §11).

---

## 11. Language & localization

- The entire platform supports **Romanian (primary) and English (secondary)**.
- Default language: Romanian.
- User can switch language in app settings.
- Restaurant profiles entered in both languages via the admin tool.
- All notification text exists in both languages.
- All UI labels, buttons, system messages translated.

### Locale formats
- **Time format: 24-hour (`HH:mm`)** for all DISPLAYED times across the app — Reservations list, Calendar grid, mobile My Reservations, etc. — using the centralized `formatTime()` helper. Native browser time inputs in entry forms (admin restaurant-create/edit, manual-reservation modal) may render in the user's browser locale (12-hour AM/PM in some browsers); the underlying form value still submits `HH:mm`. Accepted MVP tradeoff — see Decisions log 2026-05-09.
- **Date format: `DD-MM-YYYY`** (Romanian / European standard). Examples: `30-04-2026`, `15-06-2026`.
- **Currency:** RON, displayed as `1 RON` or `120 RON` (no decimals for whole amounts).
- **Timezone:** all backend timestamps stored UTC; all display in **Europe/Bucharest**. No silent UTC display anywhere.

### i18n implementation
- `next-intl` for both Next.js apps (restaurant + admin).
- `react-i18next` for the mobile app.
- Translation files: `locales/ro.json`, `locales/en.json` per app.

---

## 12. Technical edge cases

| Scenario | Handling |
|---|---|
| Two staff on different devices at the same time | Real-time sync (Socket.IO). All changes reflected instantly. **Conflict resolution: last-write-wins.** No user-presence indicators. |
| User makes reservation outside opening hours | Not possible. Time slots only show within service periods. Days marked closed don't appear. |
| User tries to book on a disabled day (holiday, private event) | Not possible. Restaurant doesn't appear as available for that day. |
| Multiple reservations per user at same restaurant | Allowed. |
| Multiple reservations per user at different restaurants | Allowed. |
| Guest arrives early (10 min before reservation) | Staff seats them via LIVE mode. Table → Red. Calendar shows original time; LIVE shows reality. |
| Restaurant closes unexpectedly | **Not handled for MVP** — no bulk-cancel feature. Workaround: staff cancels reservations one at a time. |
| Internet goes down at restaurant | **Not handled for MVP** — no offline mode. Workaround: staff falls back to paper. |
| Overlapping reservation times at same table | Not possible. System blocks table for 120-minute duration. If table frees early, remaining time is released. |
| Banned user tries to book | Restaurant appears permanently fully booked. No error message. User cannot book. |
| Diner has no phone number on file and push is unavailable | Notification simply doesn't send. Diner sees the reservation status when they next open the app. |
| Staff-created reservation never gets a table assigned | Reservation stays as `AutoConfirmed` with `tableId = null` and shows "[unassigned]" in the UI. Staff can assign later via "Pick table". |

---

## 13. Definition of Done

A feature is not done unless **every** box is checked:

1. **Backend route exists, returns the right shape, and is tested via curl or REST client.**
2. **Frontend calls the real endpoint** (no `// TODO: replace with real API` comments).
3. **Loading state + error state + empty state are all handled in the UI.**
4. **Form inputs have validation** (party size 1–30, future dates only, required fields, etc.).
5. **Auth gate respected** — restaurant staff can only see their own restaurant; admins can see everything; diners can't hit admin endpoints.
6. **The flow round-trips end-to-end** — verified by manual click-through in a real browser, not just API tests.
7. **Uses the design system** — no inline hex colors, no one-off Tailwind colors that don't match the palette in `packages/shared/theme/colors.js`.
8. **No console errors** in browser/Metro when navigating the flow.
9. **Spec match** — behavior matches this `SPEC.md`. If there's a conflict, surface it; don't silently change either side.
10. **Bilingual** — UI strings go through the i18n layer (Romanian primary, English secondary). No hardcoded English in UI strings.
11. **Locale-correct** — all dates `DD-MM-YYYY`, all DISPLAYED times 24-hour `HH:mm` via `formatTime()`, all timezones Europe/Bucharest in display. Native browser time-input pickers in entry forms may render in browser locale (12h AM/PM in some browsers) — accepted MVP tradeoff per Decisions log 2026-05-09.
12. **Manual visual smoke-test passed** — for any UI change, open the app in a real browser, walk the flow, confirm correctness. API-only smoke tests are necessary but not sufficient.

---

## 14. Decisions log

Append-only record of product decisions made since the v1 docx. Each entry: date, decision, rationale.

### 2026-04-28: MVP scope cuts (originally documented in MVP_SCOPE.md)
- **Cut: Waitlist system** (entire §10 of original docx, plus 5.3 "join waitlist" path, 6.6 Waitlists page, 9.1 "waitlist origin" field). Waitlist is a feature for v2 once the core booking experience is proven.
- **Cut: Google Maps reviews** (5.2). Adds API integration complexity for marginal user value.
- **Cut: Admin Analytics & Insights** (7.4). Operational nice-to-have; manual reporting is fine for MVP scale.
- **Cut: Admin Billing Support** (7.5). Sebastian invoices manually for MVP.
- **Cut: Billing Model UI** (entire §12 of original docx). See above.
- **Cut: Diacritic-insensitive search.** Romanian users will request post-MVP; not a launch blocker.
- **Cut: Variable reservation duration per restaurant.** 120-min hardcoded for MVP. Will be the #1 restaurant feedback request post-launch — plan to make per-restaurant-configurable in MVP+1.
- **Cut: Auto-ban diners after N no-shows.** Manual ban from dashboard is sufficient for MVP.
- **Cut: Phone-number international support beyond +40.** Romanian launch only.

### 2026-04-28: Auth — email + password only
**Decision:** email + password for diner and staff auth. No phone OTP for MVP.
**Rationale:** cheapest ($0), simplest, fastest to ship. Sebastian's goal was "easiest for user, cheapest for me". WhatsApp/SMS OTP deferred to MVP+1.
**Includes:** forgot-password reset (email link), GDPR account deletion (diner self-serve).

### 2026-04-28: Push notifications all in
**Decision:** Firebase + FCM for push. Free tier covers MVP.
**Rationale:** real diner experience requires push. 45-min reminder is too critical to defer.

### 2026-04-28: Per-event SMS rules
**Decision:** see §10. SMS is fallback only except restaurant-cancellation (#4) which always sends both.
**Rationale:** spec section 11 said "trying to avoid SMS as much as possible". Per-event analysis kept the high-UX moments while cutting ~75% of SMS volume.

### 2026-04-28: Reservation flow corrections
- All modifications require staff approval (not just upgrades). Simpler.
- Staff-created reservations are auto-confirmed regardless of whether a table is assigned at create time. Matches §9.5 of docx; bypasses the manual confirm flow.
- Confirmation flow uses floor-plan navigation, not a dropdown picker. Matches §6.5.
- "Confirm" (approve booking) and "Seat" (mark guest arrived) are distinct actions in the UI.

### 2026-04-28: Fixed spec contradictions from original docx
- **§9.3 auto-confirm rule clarified:** must be exact seat match AND party size ≤ 4 AND >24h ahead AND auto-confirm ON. (Original docx said "enough seats" in §9.3, "exact match" in §5.3 and §9.4. §5.3/§9.4 win.)
- **§11 SMS:** original table listed SMS for 7+ events; replaced with per-event rules (this spec §10).
- **§5.6 modification:** original docx only required approval for upgrades; now all modifications require approval.

### 2026-04-28: Real-time sync conflict resolution
**Decision:** last-write-wins. Both clients reflect server state; no conflict UI.
**Rationale:** simplest and matches restaurant-floor reality (whoever clicks last is what happened).

### 2026-04-30: Source-of-truth consolidation
**Decision:** consolidate the original docx and `MVP_SCOPE.md` into this single `SPEC.md`. Original docx is preserved in the repo as `ApRez FULL DOC MVP1.docx` for reference but **superseded** by this file. `MVP_SCOPE.md` is archived.
**Rationale:** dual-source design caused real bugs (table moving missing, menu/photo upload missing) because items in the docx but not the .md fell through the cracks.

### 2026-05-09: Accept native time-input rendering in entry forms
**Decision:** Stop trying to force 24-hour rendering on native `<input type="time">`. Display formatting (Reservations rows, Calendar columns, etc.) remains 24-hour via `formatTime()`. Entry forms accept browser-native picker which may show AM/PM.
**Rationale:** `lang="en-GB"` attribute is not honored by Chrome on this build; CSS `::-webkit` pseudo-element hack (commit `83ec3f6`, now reverted) hid the AM/PM picker but didn't convert hour display, breaking PM entry. A custom `Time24Input` component would fix it cleanly but costs more engineering than the polish is worth at MVP. Form values are unaffected (always `HH:mm` to backend).

---

## 15. Known gaps & bugs to fix

These are tracked here until they're fixed; remove entries when each is resolved + verified in browser.

**See also: memory/waiter_ux_strategy.md** — strategic framing for restaurant-platform UX changes (Tier C6). Read before any UI work on the restaurant platform.

### Bugs (small, high-priority)

**Fixed in commit 1e8ccba (verify in browser):**
- ~~Waitlist sidebar entry~~ — removed; verify with hard-refresh (Ctrl+Shift+R).
- ~~Date timezone display bug~~ — `formatDate()` slices `YYYY-MM-DD` from ISO. Verify.
- ~~Date inconsistency across views~~ — same `formatDate()` applied everywhere. Verify.
- ~~Seat-on-occupied (Seat endpoint)~~ — `PUT /seat` returns 409 if Occupied/OutOfService. Backend verified; UI surfacing verified by spot-check.
- ~~CLAUDE.md MVP_SCOPE references~~ — replaced with SPEC.md.

**Fixed in commit 011b7cf (verify in browser):**
- ~~Seat-on-occupied via assignment paths~~ — `eligible-tables` excludes Occupied/OOS, `assign-table` returns 409, diner auto-confirm picker skips Occupied/OOS. Curl-verified.

**Resolved by audit (no code change needed):**
- ~~AM/PM display bug~~ — comprehensive source + rendered-HTML grep (2026-04-30) found zero unsafe formatters in any frontend. Phase 1's `formatTime()` covered every path. Earlier observation was stale browser cache. Hard-refresh tabs.

**Accepted MVP tradeoffs (no action):**
- ~~Native `<input type="time">` AM/PM rendering in entry forms~~ — Chrome ignores `lang="en-GB"` and renders the picker in the OS locale. Display formatting (`formatTime()`) is correct everywhere it matters; entry pickers stay native. Accepted per Decisions log 2026-05-09 — a custom `Time24Input` component would fix it cleanly but is beyond MVP polish. The CSS-pseudo-element workaround in commit `83ec3f6` was reverted because it broke PM entry.

**Resolved by Tier E commit 1 (2026-05-16):**
- **§6.5 restaurant-side modification approve/reject UI + backend hardening.** Diner-side request UI + reject-handling (keep/cancel) deferred to E2; §5.6 stays partially open until then.
  - **Backend hardening on the existing endpoints** (no new routes — Tier B already shipped POST `/api/reservations/:id/modify` + PUT `/api/restaurant/modifications/:id/{approve,reject}`):
    - `POST /:id/modify` now refuses with structured 400 `reservation-not-modifiable` when the reservation is `COMPLETED`/`NO_SHOW`/`CANCELLED` (pre-Tier-E only `CANCELLED` was blocked).
    - `POST /:id/modify` now refuses with 409 `modification-already-pending` (plus `existingId`) when an unresolved modification already exists on the reservation — enforces SPEC §5.6 "one decision at a time" semantically since the spec is silent on stacking.
    - `POST /:id/modify` now refuses with 400 `no-op-modification` when no requested field is set OR every requested field matches the current reservation value. Stops the staff popup from rendering an empty amber diff callout.
    - `PUT /modifications/:id/approve` wraps the reservation update + modification update in `prisma.$transaction` so a crash between the two can't leave APPROVED stamped on the modification while the reservation row is still on the old values. Verified via injected-failure rollback in the smoke (see below).
  - **Schema additive only** — `ReservationModification.acknowledgedAt DateTime?` added (additive nullable, pushed to Railway clean). The ack endpoint that writes this column ships in E2; the column lands in E1 so the schema is in place. `ReservationStatus.MODIFICATION_PENDING` enum value tagged as deprecated dead code via a schema comment (no code path sets or reads it; the diner POST intentionally does not flip status per §5.6 "original stays active"); kept in the enum to avoid an `--accept-data-loss` cosmetic migration.
  - **Admin reservations list endpoint** (`GET /api/restaurant/reservations`) now `include`s the latest PENDING `ReservationModification` per row and flattens it onto the wire as `modificationPending: row | null` so the new Modifications tab can filter client-side without a second round-trip.
  - **Popup state-action matrix** (`apps/restaurant/lib/popupActions.js`) refactored from status-keyed to payload-keyed for the modification branch: any reservation with `modificationPending.status === 'PENDING'` returns `['confirm', 'reject']` regardless of the literal reservation status (typically `CONFIRMED`/`AUTO_CONFIRMED`). New exported helper `hasPendingModification()`. The legacy `case 'MODIFICATION_PENDING'` branch kept as defense-in-depth (defaults to `['confirm', 'reject']` rather than the prior `[]`). C6 popup-actions Node smoke extended with three new cases (G/H/I) — 15/15 PASS.
  - **`ReservationDetailPopup`** renders an inline amber callout (`bg-amber-50 border border-amber-200 rounded p-2`) above the detail `<dl>` whenever `modificationPending` is set, listing only the changed fields (date / time / party) as `old → new` rows — a party-only mod shows one row, not three. Approve/reject ActionButtons reuse the `confirm`/`reject` variants with label overrides (`actions.approveModification` / `actions.rejectModification`) and suppressed subtext so the buttons read "Approve change" / "Reject change" instead of the default "Confirm" / "Reject"; click handlers PUT to `/api/restaurant/modifications/:modId/{approve,reject}` and toast on success. The "Modification approval ships in Tier D." placeholder string + its `popup.modificationDeferred` i18n key are fully removed from both `ro.json` and `en.json`. ActionButton tweaked to allow explicit subtext suppression (`subtext === null`) while `undefined` still picks the default for ambiguous variants — backward-compat preserved.
  - **Reservations page** gains a fourth tab "Modifications ({count})". Tab filter: `r.modificationPending != null && r.modificationPending.status === 'PENDING'`. Side-loaded count refreshes on every `reservation:updated` socket event so the badge tracks the queue in real time across tabs. Row inline shows a short "Wants: 07-06-2026 · 19:00 → 20:00 · ×2 → ×4" snippet under the guest name (DD-MM-YYYY per §11) and is clickable → opens the standard popup with the new amber callout + approve/reject.
  - **~8 new i18n keys** under `popup.*` (modificationCallout / modificationDate / modificationTime / modificationParty / modificationApproved / modificationRejected), `actions.approveModification` + `actions.rejectModification`, and `reservations.tabModifications` + `reservations.modificationDiffInline`. RO + EN parallel.
  - **Dispatcher events** (`MODIFICATION_REQUESTED` #10, `MODIFICATION_APPROVED` #5, `MODIFICATION_REJECTED` #6) already existed with RO+EN templates from C1; no changes. The §10 channel routing (push + in-app for restaurant; push only for diner approved; push primary + sms fallback for diner rejected) is unchanged. RO copy on `MODIFICATION_REJECTED` already telegraphs the spec's "Vrei să păstrezi rezervarea originală?" prompt that E2 will surface in mobile UI.
  - **Socket §5a contract** unchanged — `events.md` already documented the `modificationPending`/`modificationRejected` sub-objects on `reservation:updated` from earlier work.
  - **End-to-end backend smoke** (`server/scripts/smoke-tiere1.js`) — 31/31 PASS: seed CONFIRMED, POST modify (date+party), second POST → `modification-already-pending`, empty-body POST → `no-op-modification`, same-values POST → `no-op-modification`, POST on COMPLETED → `reservation-not-modifiable`, approve → 200 + reservation mutated + APPROVED template renders correct RO+EN, **injected-failure rollback** (Prisma `$transaction` with a bad second op → P2025 error, reservation.partySize unchanged, modification.status unchanged), reject → 200 + REJECTED template includes the RO "Vrei să păstrezi rezervarea originală?" copy, and the list-endpoint reshape carries `modificationPending` correctly.
  - **Regression battery green:** C6 popup-actions Node smoke 15/15 (with the three new G/H/I cases), Tier F2 smoke 24/24, Tier D2 smoke 22/22, new C1 dispatcher 12-event template-render check (`server/.smoke/c1-dispatcher-templates-test.js`) 12/12. Source-grep confirms zero remaining references to the old `modificationDeferred` / "Modification approval ships in Tier D." copy.

**Resolved by Tier F commit 2 (2026-05-16):**
- **§7.1 Reservation-disabled days** (per-restaurant calendar of dates that block new bookings) and **§7.2 custom grid dimensions per section + section deletion + grid resize**. Reuses the existing `DisabledDate` model (shipped in Tier B with the same shape — `{ id, restaurantId, date @db.Date, reason? }` + a `@@unique([restaurantId, date])`); no new schema. `TableSection.gridRows/gridColumns` columns already existed too, so this commit is pure routes + UI + guards.
  - **3 new admin endpoints** for disabled dates (all `authenticateAdmin`, under `/api/admin`):
    - `GET /restaurants/:id/disabled-dates` — list, sorted by date asc.
    - `POST /restaurants/:id/disabled-dates` body `{ date: 'YYYY-MM-DD', reason? }` — rejects past dates with `error.code='date-in-past'`; rejects duplicates with `error.code='already-exists'` (pre-checked + DB-unique-backed).
    - `DELETE /restaurants/:id/disabled-dates/:dateId`.
  - **1 new diner-facing endpoint:** `GET /api/restaurants/:id/disabled-dates` — authenticated, filtered to today-and-future, returns `[{ date, reason }, …]`. Used by the mobile date picker to gray dates client-side; the existing server-side enforcement in `POST /reservations` (`reservation.routes.js:100-106`) and `GET /restaurants/:id/time-slots` (`restaurant.routes.js:278-287`) is unchanged.
  - **2 new structured 409 contracts** on existing section endpoints (`PUT /api/admin/sections/:id` + `DELETE /api/admin/sections/:id`):
    - `shrink-orphans-tables` — when a shrink would orphan tables. Body: `{ error: { code, message, orphanCount, sampleTables: [{id, tableNumber, gridRow, gridCol}], newRows, newCols } }`. Pre-checked before the update so the section stays in its prior valid state on rejection.
    - `section-has-reservations` — when DELETE would orphan future reservations (excludes `CANCELLED`/`NO_SHOW`). Body: `{ error: { code, message, count, nextDate, nextTime } }`. When only past reservations are attached, the endpoint instead null-out their `tableId` in a transaction so cascade-delete doesn't FK-fail and the audit row stays intact (`Reservation.tableId` is nullable).
  - **Admin UI:**
    - New `apps/admin/components/DisabledDatesSection.jsx` wired into the restaurant edit page between Service Periods and Photos. Inline form (date picker + optional reason ≤ 200 chars + Add button), `DD-MM-YYYY` display per §11, ✕ remove button per row, empty state, localized error surfaces for `already-exists`/`date-in-past`.
    - Layout editor (`apps/admin/app/dashboard/restaurants/[id]/layout-editor/page.js`) gains per-section "✏️ Edit grid" and "🗑 Delete section" buttons in the active-section header; two inline `EditGridModal` + `DeleteSectionModal` subcomponents render confirmations and surface the localized 409 copy (with sample table numbers + future-reservation count) without a second round-trip — `apps/admin/lib/api.js` now attaches the parsed JSON payload to thrown `Error.payload` so handlers can pull structured fields cleanly.
    - **~28 new i18n keys** under `disabledDates.*` + `sectionOps.*` in `apps/admin/locales/{ro,en}.json` (RO primary).
  - **Mobile diner UI** (`BookReservationScreen.js`): fetches `/restaurants/:id/disabled-dates` on mount; date scroll renders disabled dates with grayed background + strikethrough text + a small "—" marker; tapping a disabled date opens a `Closed` alert showing the reason if set (no-op selection). Non-blocking failure — server still enforces.
  - **End-to-end backend smoke 9/9 paths green** (`server/scripts/smoke-tierf2.js`): POST disabled-date for tomorrow, dup → `already-exists`, past → `date-in-past`, DELETE, diner reservation on disabled date rejected + time-slots `disabled:true` + list returns the date, section shrink with table at (5,0) → 409 `shrink-orphans-tables` with `orphanCount=1` + matching `sampleTables`, expand → 200, DELETE section with future reservation → 409 `section-has-reservations` with `count=1`, DELETE empty (or past-only) section → 200. Tier F1 admin restaurant GET (now also returns `photos[]`) and Tier D2 diner login re-verified for non-regression.
- **Decision:** the spec called for a new table `ReservationDisabledDate` and added columns `rows`/`cols` on `RestaurantSection`. Both already existed under shorter names (`DisabledDate`, `gridRows`, `gridColumns`); we reused them rather than introducing parallel models. Behavior matches the spec; only naming differs.
- **Fix-the-fix (2026-05-16):** the original `DisabledDatesSection` wrapped its inputs in a nested `<form onSubmit={handleAdd}>` inside the parent `EditRestaurantPage` form. Nested forms are invalid HTML and the parent form was stealing the Add button's submit, so the disabled date never persisted (the input cleared from the parent's re-render and Network log showed a navigation, not the POST). Backend was always fine. Fix: dropped the nested `<form>` for a `<div>`, switched the Add button to `type="button" onClick={handleAdd}`, and added an `onKeyDown` Enter handler on the inputs that calls `handleAdd` + `stopPropagation()` to keep the "press Enter to submit" ergonomic without re-triggering the outer restaurant-save. Audit of `EditRestaurantPage` + `PhotosSection`/`MenuSection`/`ServicePeriods` row found this was the only nested-form offender. Layout-editor buttons missing `type="button"` were *flagged* but not changed — the layout editor has no parent `<form>`, so they're harmless defaults today. QA paths re-verified post-fix: diner GET `/disabled-dates` returns the row, time-slots `disabled:true`, diner reservation rejected; `PUT /sections/:id` shrink → verbatim `shrink-orphans-tables` body with `orphanCount + sampleTables + newRows/newCols`; `DELETE /sections/:id` with future reservation → verbatim `section-has-reservations` body with `count + nextDate + nextTime`; `DELETE` past-only (non-cancelled) → 200 + the past reservation row's `tableId` is null afterwards so the FK doesn't crash (`server/scripts/verify-tierf2-qa.js`).

**Resolved by Tier F commit 1 (2026-05-16):**
- **§7.1 Photo uploads + Menu PDF upload** for restaurants in admin tool, served from a Railway volume mount in production (`UPLOADS_DIR=/var/aprez-uploads`) and a local `server/uploads/` directory in dev (git-ignored).
  - **5 new admin endpoints** (all `authenticateAdmin`), mounted at `/api/admin`:
    - `POST /restaurants/:id/photos` — multipart, field `photo`, JPG/PNG, max 5 MB, hard cap 10 photos per restaurant (SPEC §7.1). Returns the new RestaurantPhoto row.
    - `DELETE /restaurants/:id/photos/:photoId` — removes DB row + file from disk; if the deleted photo was the current cover, clears `Restaurant.coverPhotoUrl` in the same transaction.
    - `PUT /restaurants/:id/photos/:photoId/cover` — flips `isCover` on the target photo (clears any prior cover in the same restaurant) and updates the denormalized `Restaurant.coverPhotoUrl` mirror — single transaction.
    - `POST /restaurants/:id/menu` — multipart, field `menu`, PDF-only, max 10 MB. Writes to a fixed `menu.pdf` filename per restaurant (one menu per restaurant per SPEC §7.1; replace overwrites in-place). Sets `Restaurant.menuPdfUrl`.
    - `DELETE /restaurants/:id/menu` — clears `menuPdfUrl` + removes the file.
  - **Shared upload helper** at `server/src/lib/uploads.js` — multer + diskStorage with per-file mime/size validation, UUID-keyed filenames, lazy-mkdir of per-restaurant subdirs, and an `handleUploadError` middleware that converts MulterErrors into stable JSON 400s with `error.code` (`file-too-large`, `invalid-file-type`, `photo-limit-reached`, etc.) so the admin UI can surface localized copy.
  - **Static serving:** `app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }))` in `server/src/index.js`. Public-by-design (diners need cover photos on the home list); the DB stores public-path values like `/uploads/{rid}/photos/{uuid}.jpg` so reads don't need a join.
  - **Schema addition:** `RestaurantPhoto.isCover` (boolean, additive, default `false`). Existing `Restaurant.coverPhotoUrl` and `Restaurant.menuPdfUrl` columns and the `RestaurantPhoto` model were already present from Tier B — only `isCover` was missing.
  - **Admin UI:** new `<PhotosSection>` and `<MenuSection>` components under `apps/admin/components/`, wired into `app/dashboard/restaurants/[id]/page.js`. Photos: large cover preview + 2/3/4-col responsive gallery grid with hover-revealed "★ Set as cover" + "✕ Delete" buttons per thumbnail; multi-select file picker; live "X of 10" counter; client-side pre-validation of mime/size before round-trip; inline localized error surfacing. Menu: filename + "View PDF" link, Replace + Remove buttons. ~25 new i18n keys under `photoUpload.*` + `menuUpload.*` in `apps/admin/locales/{ro,en}.json`. New `apiUpload(path, field, file)` + `uploadUrl(relPath)` helpers in `apps/admin/lib/api.js`.
  - **Mobile diner UI** (`apps/mobile/src/screens/RestaurantDetailScreen.js`): cover image now resolves through new `mediaUrl()` helper in `apps/mobile/src/lib/api.js` (prepends API host minus `/api`); new horizontal paging carousel renders all `restaurant.photos[]`; new "View Menu" button opens `menuPdfUrl` via `Linking.openURL` when set.
  - **End-to-end backend smoke 7/7 paths green** (`server/scripts/smoke-tierf1.js`): JPG upload + file-on-disk, >5 MB rejected `file-too-large`, .txt rejected `invalid-file-type`, 11th photo rejected `photo-limit-reached`, cover-flip toggles both `isCover` flags + the `coverPhotoUrl` mirror, DELETE removes both row + file + clears cover, menu PDF upload + retrieval + replace-with-JPG rejected + DELETE. Static-serve smoke confirms `GET /uploads/...` returns 200 with correct `Content-Type`. Tier D2 diner login re-verified for non-regression.
  - **Storage convention** documented in `server/src/lib/uploads.js`: `{UPLOADS_DIR}/{restaurantId}/photos/{photoId}.{ext}` and `{UPLOADS_DIR}/{restaurantId}/menu.pdf`. Dev fallback to `server/uploads/` keeps the contract identical without requiring a Railway volume locally. `.gitignore` updated.

**Resolved by Tier D commit 2 (2026-05-16):**
- **§3.3 / §5.9 Diner forgot-password + GDPR account deletion + phone-collection prompt.**
  - `POST /api/auth/diner/forgot-password` — neutral 200 regardless of match, single-use 1-hour-TTL token persisted in the polymorphic `PasswordResetToken` table (reused from Tier D commit 1 with `userType='user'`). Skips the email send when the matched user is soft-deleted or registered phone-only (no passwordHash to reset). Email links use a deep-link scheme `aprez://reset-password?token=…` plus an optional web fallback (`DINER_WEB_FALLBACK_URL` env) for diners reading email on a non-phone device.
  - `POST /api/auth/diner/reset-password` — mirror of the restaurant endpoint, scoped to `userType='user'` so a staff token can't be redeemed via the diner path. Also rejects tokens whose target user was soft-deleted between issue and redemption.
  - `DELETE /api/users/me` — GDPR §5.9 account deletion. Soft-deletes (sets `User.deletedAt`) so reservation history stays referentially intact for the restaurant side; PII fields on the user row (email, phone, passwordHash, expoPushToken, location, firstName/lastName) and on every `Reservation` the user booked (guestName → `[deleted account]`, guestPhone/Email → null) are wiped in a single transaction. Favorites are dropped; outstanding password-reset tokens for the user are invalidated. Idempotent.
  - **Auth middleware JWT invalidation** — `server/src/middleware/auth.js` now does a per-request `User.deletedAt` check for `role='user'` tokens and returns 401 `account-deleted` if set. Scoped to `role='user'` so restaurant/admin requests stay zero-cost. Without this check, a stolen diner token would survive deletion for up to 7 days (JWT TTL).
  - **Schema additions:** `User.deletedAt` (timestamp, nullable, additive) and `User.phonePromptSeenAt` (timestamp, nullable, additive). Pushed to Railway with no data-loss prompt.
  - **Mobile diner app:** new `ForgotPasswordScreen` and `ResetPasswordScreen` in the `AuthStack`; `LoginScreen` gains a "Forgot password?" link. Expo Linking config wired in `app.json` (`scheme: "aprez"`) + `NavigationContainer linking` config so the email's `aprez://reset-password?token=…` deep link lands directly on `ResetPasswordScreen` with the token in `route.params`. `ProfileScreen` adds a "Danger zone" section with an explicit warning modal that calls the new `AuthContext.deleteAccount`; the AuthStack auto-bounces once the context's `user` clears. `BookReservationScreen` promotes the post-booking Alert to an inline `step=4` success view; for diners whose `User.phone` is null and `User.phonePromptSeenAt` is null it renders a soft "Add a phone number?" card with `+40` regex validation; both "Add phone" and "Maybe later" stamp `User.phonePromptSeenAt` via `POST /api/users/me/phone-prompt-seen` so the prompt never re-appears.
  - **i18n keys added** across `apps/mobile/src/locales/{ro,en}.json`: `login.forgotLink`, `forgot.*` (11 keys), `reset.*` (12 keys), `deleteAccount.*` (8 keys), `phonePrompt.*` (7 keys), `bookConfirm.*` (6 keys). RO is the primary; EN parallel.
  - **Drive-by bug fix:** `AuthContext.updateProfile` was POSTing to the non-existent `/users/profile` (404); fixed to `/users/me`. Pre-existed Tier D and would have blocked the profile-edit flow once the user tried it.
  - End-to-end backend smoke 5/5 passes (`server/scripts/smoke-tierd2.js`): diner forgot-password → 200 neutral; diner reset with real token → 200; token re-use → 400 `token-used`; bad token → 400 `invalid-token`; `phone-prompt-seen` stamps the column; `DELETE /users/me` anonymizes the reservation + soft-deletes; old JWT after deletion → 401 `account-deleted`. Tier D commit 1 (restaurant reset) regression also re-verified.

**Resolved by Tier C2 (2026-05-09):**
- ~~Email transport stub~~ — `server/src/services/notifications/channels/email.js` now sends via the Resend SDK using `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `RESEND_FROM_NAME` from `server/.env`. Falls back to console.log with a one-time warning when the key is missing (dev environments don't crash). Failures from Resend are logged but don't propagate past the dispatcher, so a bad email can't break the calling flow. Unblocks the email pieces of §5.9 (account-deletion confirmation), §6.8 (staff forgot-password reset), and §7.1 (admin staff-credentials handoff) — those flows still need their own wiring in Tier D and admin polish.

**Resolved by Tier C6 Phase 2 (2026-05-16):**
- **Shared infrastructure components landed** in `apps/restaurant/components/`. Each component is standalone-verified via the `/dashboard/phase2-demo` route (not linked from sidebar; deleted in Phase 3 cleanup). Components are not yet wired into the real pages — that's Phase 3.
  - `components/ui/ToastProvider.jsx` + `Toast.jsx` + `useToast` hook — stack max 3, variants (info/success/warning/error/undo), tap-to-dismiss, position top-right desktop / top-center mobile. All copy via i18n.
  - `components/ui/ActionButton.jsx` — variants `confirm`, `reject`, `seat`, `pickTable`, `reassignTable`, `cancel`, `complete`, `edit`, `noshow`. Always-visible subtext for ambiguous variants (confirm/seat/pickTable/complete) per §3.11; unambiguous variants render label-only. Min 48×48 touch target per §4.5.
  - `components/ReservationDetailPopup.jsx` — full §3.1 state-action matrix (Pending/Confirmed/AutoConfirmed/AwaitingGuest/Occupied/Completed/Cancelled/NoShow/ModificationPending). Subscribes to `reservation:updated` (re-renders in place) and `reservation:cancelled` (closes with toast). Special-requests badge, "X min late" badge when `secondsLate > 600`. Responsive: full-screen sheet <768px, centered 560px modal ≥768px.
  - `components/QuickAddReservation.jsx` — smart defaults (next-open-day via `openingHours`, next round 30-min slot, party 2), autofocus name, optional details collapsible, live availability hint (300ms debounced call to `GET /api/restaurant/availability`), closed-hours warning before save, pending-sync save per §4.2 with 10s timeout fallback, Tab/Enter/Esc keyboard handling. Responsive same as popup.
- `components/ReconnectingBanner.jsx` (C4) audited — already uses i18n key `common.reconnecting` (added C5); fixed responsive offset (`left-0 md:left-64`) so the banner doesn't leave a sidebar-shaped gap on phone viewports.
- `lib/socket.js` (C4) audited — public-API contract documented as a docstring block at the top so Phase 2/3 components can subscribe without coupling to internals.

**Resolved by Tier C6 Phase 3 items 8+9 (2026-05-16):**
- **§6.4 calendar interactions** (click-block popup, tap-empty-slot to create, OOS warning) — Calendar page now opens the shared `ReservationDetailPopup` on existing-reservation cell clicks and the `QuickAddReservation` modal (prefilled with `date`/`time`/`tableId`) on empty-cell clicks. Clicking an OUT_OF_SERVICE cell fires a `calendar.tableOutOfServiceToast` warning toast without opening Quick Add. Edit-seats affordance + confirm-from-calendar are still deferred (admin scope / requires section-grid editing).
- **§3.10 Calendar "now" indicator** — `<CalendarNowIndicator>` mounted in the calendar grid. Owns its own setInterval and mutates the matching `<tr data-time>` directly so the parent calendar's React tree stays stable across minute ticks. Renders nothing when `selectedDate !== today`.
- **§3.12 Special Requests inline visibility** — shared `<SpecialRequestsBadge>` component now mounted on Reservations rows, Calendar block cells, Dashboard NOW + NEXT rows, Live overlay (refactored from inline to the shared component), and `ReservationDetailPopup` header. Single source-of-truth for the ✦ icon + tooltip.
- **§3.13 Late-arrival display** — shared `<MinLateBadge>` component, single threshold (`secondsLate > 600`). Mounted on Live overlay, Dashboard NOW, ReservationDetailPopup header, and Reservations rows (Reservations computes `secondsLate` client-side from `res.time` + `res.table.status === 'AWAITING_GUEST'` since the `/reservations` endpoint doesn't return it; the other surfaces use the backend-computed value from `/layout/live` and `/dashboard/summary`).
- **§3.10 QuickAdd `prefill.tableId`** — when QuickAdd opens from a calendar empty-cell click, the cell's `tableId` is pre-selected; a passive `quickAdd.prefilledTable` badge renders at the top of the form with a × to clear. POST body carries `tableId`; backend POST already accepted it.

**Resolved by Tier C6 Phase 1 (2026-05-16):**
- **New endpoints + amended shapes (locked data contracts for C6 UI work — full payload reference in `server/src/socket/events.md` for Socket.IO and inline in the route handlers for HTTP).**
  - `GET /api/restaurant/dashboard/summary` (new) — powers §3.8 Dashboard rebuild. Returns `{ currentTime, activeReservations[], upcomingReservations[8], pendingConfirmationCount, todayCount, occupiedCount }` in one round-trip.
  - `GET /api/restaurant/layout/live` (amended) — each table object now carries `currentReservation`, `nextReservation`, and `secondsLate` (in addition to the pre-existing `occupancyDurationMin` and `hasAlert`). Powers §3.7 floor-plan overlay + §3.13 late-arrival display. Fixed a pre-existing route-ordering shadow: `/layout/:sectionId`'s UUID validator was rejecting the literal `/live` before the dedicated handler could run; the validator now allows `'live'` through and the section handler delegates via `next('route')`.
  - `GET /api/restaurant/availability` (new) — powers §3.3 Quick Add live availability hint. Returns `{ exactMatchCount, anyMatchCount, suggestionForCombining }`. Skips Occupied/OutOfService tables per §8.1.
  - `PUT /api/restaurant/reservations/:id` (new) — generic staff edit for §3.9. Accepts date/time/partySize/guestName/guestPhone/specialRequests. Conflict + opening-hours validation deferred per SPEC §9.5 trust model. Emits `reservation:updated`.
  - `PUT /api/restaurant/tables/:id/seat` (extended) — now writes a `TableActivity { kind: WALK_IN, partySize, startedAt }` row in addition to flipping the table to OCCUPIED. The `walkin:created` event payload carries the new `activityId`. `PUT /api/restaurant/tables/:id/status` closes the open WALK_IN activity row (sets `endedAt`) on any OCCUPIED→FREE transition and includes `activityId` in `walkin:ended`. First writer of the previously unused `TableActivity` model.
- **Socket.IO event payload contract** documented in `server/src/socket/events.md` — canonical shape for each of the seven §5a events, per-event emit sites, and subscriber guidance. The shapes were already consistent in C4; Phase 1 just made the contract formal.
- **Performance budgets verified** (p95, 50 sequential calls against the seeded La Mama restaurant): dashboard/summary 123ms (≤500), layout/live 116ms (≤300), availability 178ms (≤200), reservations today 62ms (≤400), reservations pending 144ms (≤400), PUT edit 334ms (≤400), PUT seat/walkin 225ms (≤400). PUT edit needed an `updateMany` + `findUnique` refactor to drop a redundant restaurant-join round-trip — first pass came in at p95=697ms.

**Partially resolved by Tier C5 (2026-05-16):**
- ~~i18n plumbing~~ — **scaffold complete** in all three frontends. Restaurant + admin use `next-intl` (`NextIntlClientProvider` wired client-side via `lib/i18n/I18nProvider.jsx`; locale persisted in `localStorage`; `timeZone="Europe/Bucharest"` set per SPEC §11). Mobile uses `i18next` + `react-i18next` (init in `src/lib/i18n.js`; locale persisted in `SecureStore`; on login `AuthContext` seeds the locale from `User.preferredLanguage`; on toggle the mobile app syncs back to the server via `PUT /api/users/me/language`). Sample keys (~15 restaurant, ~8 admin, ~10 mobile) round-trip end-to-end through the language toggle. **Full string coverage remains incremental work for C6 and beyond per memory/waiter_ux_strategy.md §4.6 — every new C6 string must go through i18n keys; older hardcoded strings will be picked up as their surrounding component is touched.** The pre-existing `PUT /api/users/me/language` route (and `GET /me`'s `language: true` select) referenced a column that doesn't exist on the schema; fixed as part of C5 since the mobile toggle depends on it. URL-based locale routing (`/ro/*`, `/en/*`) was deferred — would require moving every route under `app/[locale]/`, which is outside the scaffold scope.

**Resolved by Tier C4 (2026-05-16):**
- ~~Socket.IO real-time wiring~~ — backend now emits the §5a event set (`reservation:created`, `reservation:pending-created`, `reservation:updated`, `reservation:cancelled`, `table:status-changed`, `walkin:created`, `walkin:ended`) at every reservation/table mutation point in `server/src/routes/reservation.routes.js` and `server/src/routes/restaurantPlatform.routes.js`. The legacy `table:statusChanged` camelCase event was renamed to `table:status-changed` per spec; no frontend depended on the old name. Socket.IO handshake now verifies JWT via `io.use` middleware and auto-joins `restaurant:{id}`, `user:{id}`, or `admin:global` based on the token's role. Tokenless connections remain allowed for back-compat with the legacy `join:*` events that dev/test scripts rely on.
- ~~Frontend Socket.IO clients in restaurant + admin + mobile~~ — `socket.io-client@^4.8.0` installed in all three apps. Restaurant: shared `lib/socket.js` singleton + `lib/useSocketRefetch.js` hook + `components/ReconnectingBanner.jsx` mounted in dashboard layout; the three list pages (Reservations, Live, Calendar) subscribe to relevant §5a events and update local state surgically (no whole-list refetch on every event). Reconnect + tab-visibility triggers a single refetch per §4.4. Admin: same shared lib + banner; dashboard page increments a live pending counter from `reservation:pending-created`. Mobile: `src/lib/socket.js` with async `getSocket()` reading the JWT from SecureStore; `ReservationsScreen` subscribes to `reservation:updated` / `reservation:cancelled` on the user's room and renders a thin amber "Reconnecting…" banner when the socket has been down >2s. AuthContext rebuilds the socket on login/register/logout so the handshake token always matches the current user.

**Resolved by Tier C3 (2026-05-09):**
- ~~Push transport stub~~ — `server/src/services/notifications/channels/push.js` now POSTs to `https://exp.host/--/api/v2/push/send` using built-in fetch. Optional `EXPO_ACCESS_TOKEN` env var enables Bearer auth; unauthenticated mode is acceptable for MVP volume and logs a one-time info note. Token format validated (`ExponentPushToken[…]` / `ExpoPushToken[…]`); null or malformed tokens log `[push:skip]` and let the dispatcher's existing §10 fallback chain handle delivery (SMS for events #2/#3/#6/#7, skip-only for #1/#5). HTTP/network errors are logged and never propagate past the dispatcher.
- ~~§5.7 45-minute reminder cron job~~ — `server/src/jobs/reminders.js` exports `checkAndFireRemindersFor(prisma, io, now)` which finds confirmed/auto-confirmed reservations whose Bucharest wall-clock start is in `[now+44min, now+46min]` and fires `RESERVATION_REMINDER_45` once per reservation. Dedup via `Reservation.reminderSentAt` so a within-window second tick doesn't double-send. The existing `setInterval` in `socket/handlers.js` calls into this job each minute. The dispatcher now forwards a `data` field through to the push channel so the mobile app can render `{ yes: 'confirm', no: 'cancel', reservationId }` action buttons.
- **Schema additions (2026-05-09):** `User.expoPushToken` (text, nullable) added; old `User.fcmToken` kept as a deprecated column with no readers (drop in a follow-up commit when explicit `--accept-data-loss` approval is given). `Reservation.reminderSentAt` (timestamp, nullable) added. Both pushed to Railway with no data-loss prompt — purely additive. `PUT /api/users/me/fcm-token` renamed to `PUT /api/users/me/push-token` with body field `expoPushToken`; mobile-side wiring lands in a later tier.

**Still open after Phase 2 audit (2026-04-30):**
- **Calendar doesn't show walk-ins or current occupation state.** §6.4 updated — calendar must display all table activity including walk-ins and currently-occupied state, not just reservation blocks. Schema needs new `TableActivity` model; see Phase 3 plan.
- **§9.3 auto-confirm uses `gte`, not exact seat-match.** `server/src/routes/reservation.routes.js:128` filters `seatCount: { gte: pSize }`. Spec mandates `seatCount === partySize`. Currently a 4-person party with no exact 4-seat free table can be auto-confirmed onto a 6-seat table.
- **§9.3 "most free neighbors" preference missing.** When multiple exact-match tables qualify for auto-confirm, picker should prefer the one with the most adjacent free tables (for combining flexibility). Currently picks `seatCount asc` first match.
- **§3.1 +40 phone format not validated.** Code accepts any string at registration (`auth.routes.js:14`). Spec requires `/^\+40\d{9}$/` regex.
- **§3.4 OTP routes still mounted.** `auth.routes.js:91-183` has `/send-otp` + `/verify-otp` despite §3.4 cutting OTP. Routes should be deleted.
- **§3.2 30-day reservation pruning job missing.** Schema supports the rolling window query but no scheduled cleanup runs.
- **§7.4 + §7.5 admin analytics + billing still mounted.** Backend: `admin.routes.js:871-971` (analytics), `:977-1180` (billing). Frontend: `apps/admin/app/dashboard/billing/page.js` still on disk (only links removed). Spec cut both — delete code.
- **Waitlist server routes still mounted.** `server/src/routes/restaurantPlatform.routes.js:1117-1303`. Schema models `Waitlist*` also still present. Spec cut entirely.
- **§5.1 multi-filter on mobile home missing.** Only cuisine + search exposed. Spec requires location, party-size, date, time as combinable filters.
- **§5.2 mobile profile gaps.** Photo gallery (swipeable), Google Maps embed, menu PDF viewer all missing.
- **§5.6 modification request UI missing on mobile.** Backend route exists; no diner UI to initiate or to keep-or-cancel on rejection.
- **§6.2 dashboard gaps — partially resolved by Tier C6 P3-7 (2026-05-16).** Dashboard rebuilt as the waiter command center per `memory/waiter_ux_strategy.md` §3.8: three-zone layout (NOW / NEXT / SEARCH) with stat tiles and a header clock; dashboard-level guest search now in place (debounced 300ms call to `/api/restaurant/reservations/search`); "Add Reservation" entry point is the global floating + button (P3-1) which is visible on the dashboard (and every other dashboard page) per §3.2. **Still deferred to Tier J / future:** notification feed (separate from real-time toast — toast covers the urgent path via P3-2), ban-client search on dashboard (low-frequency operation per §3.8 out-of-scope list).
- **§6.3 service period filter on Live.** Calendar has it; Live page doesn't.
<!-- §6.4 calendar interactions: click-block popup + tap-empty-slot resolved by C6 P3-8 — see Resolved section above. Edit-seats affordance + confirm-from-calendar remain deferred (admin scope + larger UX). -->
<!-- §6.5 modification request UI missing on restaurant — resolved by Tier E commit 1 (2026-05-16). ReservationDetailPopup renders amber "Requested changes:" callout + Approve change / Reject change buttons; new Modifications tab on the Reservations page with side-loaded count badge; backend POST /modify hardened (reservation-not-modifiable, modification-already-pending, no-op-modification); approve wrapped in $transaction. Diner-side request UI still pending in §5.6 above (Tier E commit 2). See Resolved-by-Tier-E-commit-1. -->
- **§6.7 staff-side photos and menu PDF upload missing.** §6.7 lists them as editable; only admin-side endpoints exist.
- **Confused Flow (b) instruction in past Cowork session.** "Diner books" should be tested via the mobile app, not via the staff create form. Spec is unchanged; just a testing/communication note.

### Missing features (IN scope, never built)
<!-- §5.9 Account deletion (GDPR) — resolved by Tier D commit 2 (2026-05-16). DELETE /api/users/me soft-deletes the User row (sets deletedAt; auth middleware rejects outstanding JWTs) and anonymizes PII on all of the user's reservation rows in a single transaction. Mobile ProfileScreen "Danger zone" + confirmation modal. See Resolved-by-Tier-D-commit-2 above. -->
<!-- §3.3 Diner forgot-password — resolved by Tier D commit 2 (2026-05-16). See Resolved-by-Tier-D-commit-2 above. -->
<!-- §3.1 post-first-reservation phone-collection prompt — resolved by Tier D commit 2 (2026-05-16). Inline soft prompt on BookReservationScreen step 4; dismissal persists via User.phonePromptSeenAt. -->

<!-- §5.3 Special requests UI: schema column added in Tier B; staff edit surface (`PUT /reservations/:id` body field + edit-mode field in popup) shipped in C6 P3-6; inline ✦ badge across all reservation surfaces shipped in C6 P3-9. Diner-side mobile field still pending Tier D. -->
<!-- §6.8 Forgot password flow for restaurant staff — resolved by Tier D commit 1 (2026-05-16). POST /api/auth/restaurant/forgot-password issues a single-use, 1-hour-TTL token and emails the reset link via the C2 Resend transport to RestaurantStaff.email (fallback Restaurant.email). POST /api/auth/restaurant/reset-password validates the token and updates the password hash. New schema additions: RestaurantStaff.email (nullable text), PasswordResetToken model with userType field (polymorphic — diner reset reuses the same table in commit 2). Frontend pages: /forgot-password, /reset-password; /login has a "Forgot password?" link. End-to-end smoke verified: forgot-password → 200 neutral message + token persisted; reset valid → 200; reset expired → 400 token-expired; reset used → 400 token-used; login with new password → 200. -->
- **§6.4 Calendar enhancements** — show walk-ins, current-occupation segments, OOS blocks, past activity, "live" segment for currently-occupied tables. See §6.4 (updated 2026-04-30).
<!-- §7.1 Photo uploads + Menu PDF upload — resolved by Tier F commit 1 (2026-05-16). Multer + Railway volume (server/uploads in dev). 5 admin endpoints + static /uploads serve + admin UI + mobile diner gallery/menu. See Resolved-by-Tier-F-commit-1 above. -->
<!-- §7.1 Reservation-disabled days — resolved by Tier F commit 2 (2026-05-16). 3 admin endpoints + 1 diner GET + mobile date picker gray-out. See Resolved-by-Tier-F-commit-2 above. -->
<!-- §7.2 Custom grid dimensions + section deletion + grid resize — resolved by Tier F commit 2 (2026-05-16). Existing PUT/DELETE /sections/:id endpoints hardened with shrink-orphans-tables + section-has-reservations 409 contracts; admin UI gains Edit grid + Delete section per-section modals. See Resolved-by-Tier-F-commit-2 above. -->
- **§8.1 "Arriving Soon" auto-transition** — Green → Orange one hour before a reservation. Cron job. Verify in floor plan that orange shows up automatically for upcoming reservations.
- **§8.1 Awaiting Guest auto-transition + 15-min recurring reminder.**
- **§8.1 120-min Occupied timer + expiry alert.**
- **§8.2 Table moving / combining** in LIVE mode. Drag-to-merge, sum seat counts, time-block scoped.
- **§9.1 `specialRequests` column** on reservation schema (if not already present).
<!-- Socket.IO real-time wiring resolved by Tier C4; i18n plumbing scaffold resolved by Tier C5; C6 Phase 1 data contracts and Phase 2 shared infrastructure (ToastProvider, ActionButton, ReservationDetailPopup, QuickAddReservation) resolved 2026-05-16 — see Resolved section above. Phase 3 wires components into pages. -->

<!-- i18n plumbing scaffold landed in Tier C5; full string coverage is incremental from C6. -->
- **§7.6 Auto-confirm toggle** UI in restaurant platform "Manage Profile" (toggle exists in admin but staff need it on the restaurant side per §6.7).

### Polish (deferred)
- All visual/UX polish work happens after the above items ship and flows are correct.
- Tailwind palette tints in status badges (`bg-green-100 text-green-800` etc.) — sweep into a secondary-action token set.
- Inline button colors (`bg-blue-500`, `bg-red-500`, etc.) for Seat/Reject/Cancel/Complete — formalize into a token set.
- `bg-sidebar` (`#1a1a2e`) — give it a semantic equivalent in the palette.

---
