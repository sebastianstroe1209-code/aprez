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

Phone is optional per §3.1, so a small percentage of users will be push-only across the board. Acceptable for MVP. Post-MVP idea: prompt for phone number after first reservation.

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

**Resolved by Tier C2 (2026-05-09):**
- ~~Email transport stub~~ — `server/src/services/notifications/channels/email.js` now sends via the Resend SDK using `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `RESEND_FROM_NAME` from `server/.env`. Falls back to console.log with a one-time warning when the key is missing (dev environments don't crash). Failures from Resend are logged but don't propagate past the dispatcher, so a bad email can't break the calling flow. Unblocks the email pieces of §5.9 (account-deletion confirmation), §6.8 (staff forgot-password reset), and §7.1 (admin staff-credentials handoff) — those flows still need their own wiring in Tier D and admin polish.

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
- **§6.2 dashboard gaps.** Notification feed, "Add Reservation" button on dashboard, ban-client search on dashboard, dashboard-level reservation search all missing. (Tier C6 — see memory/waiter_ux_strategy.md §3)
- **§6.3 service period filter on Live.** Calendar has it; Live page doesn't.
- **§6.4 calendar interactions** beyond Bug 3: click-block popup actions, tap-empty-slot to create, edit-seats affordance, confirm-from-calendar. (Tier C6 — see memory/waiter_ux_strategy.md §3)
- **§6.5 modification request UI missing on restaurant.** Backend route exists; no frontend approve/reject UI.
- **§6.7 staff-side photos and menu PDF upload missing.** §6.7 lists them as editable; only admin-side endpoints exist.
- **Confused Flow (b) instruction in past Cowork session.** "Diner books" should be tested via the mobile app, not via the staff create form. Spec is unchanged; just a testing/communication note.

### Missing features (IN scope, never built)
- **§5.9 Account deletion (GDPR)** — diner-side "Delete my account" + backend endpoint that erases PII. Required for EU compliance.
- **§5.3 Special requests free-text field** on reservation creation. (May exist on schema; UI not exposed.) (Tier C6 — see memory/waiter_ux_strategy.md §3)
- **§6.8 Forgot password flow** for restaurant staff. Email-based reset.
- **§6.4 Calendar enhancements** — show walk-ins, current-occupation segments, OOS blocks, past activity, "live" segment for currently-occupied tables. See §6.4 (updated 2026-04-30).
- **§7.1 Photos upload** for restaurants in admin tool (cover + 5–10 gallery JPG/PNG).
- **§7.1 Menu PDF upload** for restaurants in admin tool.
- **§7.1 Reservation-disabled days** field per restaurant in admin tool.
- **§7.2 Custom grid dimensions per section per restaurant.** Currently hardcoded.
- **§7.2 Layout/section deletion + grid resize.** Admin must be able to delete a section (with reservation-tied warning) and resize grids. See §7.2 (updated 2026-04-30).
- **§8.1 "Arriving Soon" auto-transition** — Green → Orange one hour before a reservation. Cron job. Verify in floor plan that orange shows up automatically for upcoming reservations.
- **§8.1 Awaiting Guest auto-transition + 15-min recurring reminder.**
- **§8.1 120-min Occupied timer + expiry alert.**
- **§8.2 Table moving / combining** in LIVE mode. Drag-to-merge, sum seat counts, time-block scoped.
- **§9.1 `specialRequests` column** on reservation schema (if not already present).
- **Socket.IO real-time wiring** in restaurant + admin frontends. Backend already emits.
- **i18n plumbing** in all three frontends. Strings currently hardcoded English.
- **§7.6 Auto-confirm toggle** UI in restaurant platform "Manage Profile" (toggle exists in admin but staff need it on the restaurant side per §6.7).

### Polish (deferred)
- All visual/UX polish work happens after the above items ship and flows are correct.
- Tailwind palette tints in status badges (`bg-green-100 text-green-800` etc.) — sweep into a secondary-action token set.
- Inline button colors (`bg-blue-500`, `bg-red-500`, etc.) for Seat/Reject/Cancel/Complete — formalize into a token set.
- `bg-sidebar` (`#1a1a2e`) — give it a semantic equivalent in the palette.

---
