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

> **Calendar role (locked v1.1 — Tier H commit 4):** the Calendar is the **past + future planning view**; **today is owned by the Live floor plan**. Loading the Calendar on today's date (Europe/Bucharest) — or selecting today in the date picker — **auto-redirects to `/dashboard/live`**. The date picker **defaults to tomorrow**; an explicit `?date=` URL param still wins (shareable links, Quick Add's date-prefill). **Past dates** render reservation blocks at their final statuses (Completed / No-show / Cancelled — the popup shows them view-only) plus read-only **walk-in segments** from `TableActivity` (amber fill, spanning `[startedAt, endedAt]` in 15-min increments); empty past-date cells are inert — you cannot book in the past. **Future dates** render reservation blocks only; empty-slot click opens Quick Add as before. OOS-history rendering on past dates is a documented v1.1 gap (see §15 "Polish (deferred)"). The bullets below describe the original full-timeline vision; where they differ, the v1.1 shipped behavior is as stated in this note.

- Displays **all table activity** across the selected date — not just reservations.
- Layout: rows = tables (with seat count), columns = time slots (scrollable across the full service period).
- Filter by section and service period.
- Date selectable; **defaults to tomorrow** (today redirects to Live — see the role note above).
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
>
> **MVP launch status (Tier J, 2026-05-20):** the SMS transport is **deferred to v1.1** — see the §14 Decisions-log entry. `channels/sms.js` logs and records SMS sends for audit but does not deliver via Twilio. Push (live as of Tier J commit 1b) covers the active-user path; the per-event SMS legs in the table below describe the v1.1 target behavior.

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
hasPush = user.expoPushToken IS NOT NULL AND user.pushEnabled = true
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

### 2026-05-20: SMS transport deferred to v1.1
**Decision:** SMS is not wired for MVP launch. `server/src/services/notifications/channels/sms.js` logs the payload and writes a `Notification` row (so the §10 fallback routing stays auditable) but does **not** call Twilio — no SMS is delivered.
**Rationale:** push is live as of Tier J commit 1b and covers the active-user delivery path per §10; standing up a Twilio account, credentials, and cost coverage is post-launch work. The SMS-only leg — the fallback for a diner with no push token on events #2/#3/#6/#7 — is still logged for audit but not delivered out-of-band. A push-less diner simply sees the reservation status on next app open, already an accepted edge case per §12.
**To do for v1.1:** Twilio account + credentials + cost coverage, then replace the `sms.js` stub body with the real send call.

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

**Resolved by Tier K (2026-05-25, 9 commits):** post-MVP-launch backend hardening sweep. K0+cleanup+K2+K3+K1+K6+K7+K8+K9+K10+K5. K4 (pagination), K12 (error-envelope unification), and K13–K16 (polish) deferred to a separate session.
- **K0 — `chore(deploy): K0 — expose RENDER_GIT_COMMIT on /api/health` (5877cd2):** `/api/health` returns `{ status, timestamp, commit, env }` so any operator can `curl` the live URL and see which SHA is serving. Verified Render auto-deploy is healthy by polling for the K0 commit to surface — landed ~3 min after push. Smoke: `k0-health-version-test.js` (9/9). Bundled fix: stale J2-era j1b smoke case [g] still asserted the removed reminder categoryId; updated to assert the J2 reality (no event carries categoryId).
- **Tier K cleanup — `chore(db): Tier K cleanup — hard-delete orphan audit user` (2d06284):** removed the `weird'quote@example.com` orphan left by the Tier K input-fuzz audit. Idempotent script at `server/scripts/cleanup-tier-k-orphans.js`. Smoke: `k-cleanup-orphans-test.js` (3/3).
- **K2 — `fix(security): K2 — helmet security headers + disable x-powered-by` (bbac063):** `helmet({ contentSecurityPolicy: false })` + `app.disable('x-powered-by')`. Live now ships HSTS, X-Frame-Options: SAMEORIGIN, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer. CSP intentionally off (no audit of inline scripts yet); flagged for a later tier. Smoke: `k2-security-headers-test.js` (6/6).
- **K3 — `fix(security): K3 — rate limit auth endpoints` (911ec14):** `express-rate-limit` on `/auth/{login,restaurant/login,admin/login}` (5/15min per (IP, identifier), `skipSuccessfulRequests:true`) and on both `/forgot-password` endpoints (3/hour per email + 10/hour per IP, two limiters chained). `app.set('trust proxy', 1)` so Render's XFF yields real client IPs. 429 returns structured `{ error: { code: 'rate-limited', retryAfterSec } }` + `Retry-After` header. Dev-only `POST /api/__test/reset-rate-limits` (404 in production) keeps Tier K smokes deterministic. Smoke: `k3-rate-limit-test.js` (32/32).
- **K1 — `fix(security): K1 — stop /auth/login leaking the Prisma UserWhereInput schema` (a9b8632):** pre-fix, an empty/malformed body on `/auth/login` returned 500 with the full UserWhereInput schema dumped (passwordHash, expoPushToken, deletedAt, etc.). Two layers: (1) the diner `/login` handler had validators declared but never called `validationResult` — fell through to `prisma.user.findUnique({ where: { email: undefined } })`. Added the validator check; tightened messages. (2) Global error sanitizer in `index.js` — production now returns `{ error: { code: 'server-error', message: 'Something went wrong…' } }` for any 5xx or Prisma error; never echoes `err.message` or `err.stack`. Dev keeps the verbose form. Smoke: `k1-prisma-leak-test.js` (30/30).
- **K6+K7+K8 — `fix(api): K6+K7+K8 — validator hardening on reservation flow` (69d8e69):** K6 — POST /reservations rejects past dates with structured `{ error: { code: 'date-in-past' } }` (was creating orphan rows with date='2025-01-01'). K7 — GET /restaurants/:id/time-slots hard-caps `partySize` at 30 (was accepting 99). K8 — same endpoint existence-checks `restaurantId` (404 `restaurant-not-found`) and rejects past dates with the K6 code. Smoke: `k6k7k8-validator-hardening-test.js` (12/12).
- **K9 — `fix(db): K9 — fix seed-reminder time-shift + backfill broken endTimes` (08859c1):** audit saw rows like `time=00:29 endTime=21:00`. Root cause: `scripts/seed-reminder-test.js` shifted `time` without updating `endTime` (the `addMinutes` math itself was correct). Fixed the script + new `scripts/backfill-endtimes.js` (idempotent, `--dry`). Ran live; 3 rows updated. Smoke: `k9-endtime-backfill-test.js` (10/10).
- **K10 — `fix(api): K10 — DELETE /users/me also cancels non-terminal reservations` (69e1b2d):** pre-K10 PII was wiped but `status` stayed PENDING/CONFIRMED/AUTO_CONFIRMED — ghost rows the restaurant couldn't action. Added a second `updateMany` inside the same `$transaction` that flips non-terminal rows to CANCELLED with `cancelledBy='system'` + `cancelledAt=now`. Terminal rows (COMPLETED/NO_SHOW/already-CANCELLED) keep their original status (historical truth). Smoke: `k10-delete-cascades-reservations-test.js` (14/14).
- **K5 — `fix(security): K5 — require password re-auth on DELETE /users/me` (a1340ef):** stolen JWT alone can no longer wipe the account. Server: `DELETE /users/me` requires body `{ password }`, bcrypt-verified; 403 `password-required` / `password-incorrect`. Mobile: inline secure `<TextInput>` in the existing Delete-account confirm modal; 4 new `deleteAccount.*` i18n keys (RO + EN). `deleteAccount()` returns `{ ok, code }`; the screen maps the structured code to localized copy. Android Metro bundle HTTP 200, 7.78 MB. Smoke: `k5-delete-requires-password-test.js` (9/9).

**Resolved by Tier I commit 3 (2026-05-17):** Tier I now FULLY COMPLETE end-to-end — calendar propagation, availability hint promotion, reservations-row mergeBinding, and the lifecycle auto-deactivate hooks all green.
- **Calendar view (apps/restaurant/app/dashboard/calendar/page.js)**: when a reservation is bound to an active merge whose window covers the reservation's time, the block in its assigned table's column renders an amber `+T3` badge (only the OTHER member labels, not its own) with the full `combinedLabel` ("T1+T3") in the `title` tooltip. Per decision 4: block stays single-column, no grid math change.
- **Reservations page (apps/restaurant/app/dashboard/reservations/page.js)**: Table column renders the row's `tableNumber` plus an inline `merged: T1+T3` tag (amber pill, `border-amber-300`) when `res.mergeBinding != null`. Matches the row pattern; no new column.
- **Quick Add availability hint promoted from boolean to array**. `GET /api/restaurant/availability` now returns:
  ```jsonc
  {
    exactMatchCount: number,
    anyMatchCount: number,
    suggestionForCombining: boolean,        // legacy: true iff mergeSuggestions.length > 0
    mergeSuggestions: [{
      tableIds: string[],                   // member UUIDs
      memberLabels: string[],               // sorted tableNumbers
      combinedLabel: "T1+T3",               // join('+') of memberLabels
      summedSeatCount: number,              // sum of member seatCount
      freeNeighborCount: number             // total free adjacents across members — combining flexibility score
    }, …]                                   // top 3 ranked by: smallest viable merge first, then highest freeNeighborCount, then tightest fit
  }
  ```
  Ranking: fewer members beats more (smallest viable merge wins ties), then higher freeNeighborCount (more combining flexibility), then smaller summedSeatCount (tighter fit to party). Helper `computeMergeSuggestions()` walks BFS-grown adjacency frontiers up to `MAX_MERGE_MEMBERS=4`, dedupes by sorted-id signature, filters to groups summing ≥ partySize.
- **`/restaurant/reservations` list payload** gains a per-row `mergeBinding: { groupId, combinedLabel, memberLabels, otherMemberLabels, summedSeatCount } | null`. The backend resolves each row's `tableId` against active TableMove rows whose window overlaps the reservation's `[time, endTime)`, then batched-fetches all member metadata for any matching groupId. `otherMemberLabels` excludes the row's own table label so the calendar block can render "+T3" without echoing its own column header.
- **Auto-deactivate on reservation lifecycle was already wired in I1** via `deactivateMergesForReservation(prisma, reservationId)` (helper at `server/src/lib/tableMerges.js`). Tier I3 smoke verifies the wiring is intact across the four call sites:
  - `PUT /api/restaurant/reservations/:id/cancel` (restaurant staff cancel)
  - `PUT /api/restaurant/reservations/:id/complete`
  - `PUT /api/restaurant/reservations/:id/no-show`
  - `PUT /api/reservations/:id/cancel` (diner cancel)
  - `POST /api/reservations/:id/modifications/:modId/ack` action=cancel (diner ack-cancel — also covered by E2)
  Pattern: the lifecycle handler calls `deactivateMergesForReservation` after the reservation update + before the socket emit. Not a single `prisma.$transaction` with the update (the helper does its own `updateMany`), but emits a `table:unmerged` socket event with `reason: 'reservation-cancelled' | '-completed' | '-no-show'` per affected group so subscribers re-render. **Pre-planned merges (`reservationId: null`) are NOT touched** — verified by smoke [h]: a pre-merge survives the cancel of an unrelated reservation in the same restaurant. End-of-day cron cleanup of pre-merges deferred to Tier J.
- **End-to-end backend smoke 8 paths green** (`server/scripts/smoke-tieri3.js`): [a] availability mergeSuggestions shape, [b] empty suggestions when no adjacency fits, [c] /reservations mergeBinding per row, [d/e/f] restaurant cancel/complete/no-show auto-deactivate, [g] diner cancel auto-deactivates, [h] pre-planned merge survives unrelated cancel.
- **Regression battery all green**: c6-assign-table-override-wiring 14/14, c6-live-grid-layout 18/18, c6-popup-actions 19/19, c1-dispatcher 12/12, Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22.
- **Cleanup confirmed**: lingering QA debris (section `7c09e62a-...` + reservation `4577ea13-...`) removed via the canonical cleanup script — reservation CANCELLED, section + 9 tables deleted via the F2 endpoint with the TableMove pre-purge workaround. KNOWN ISSUE on `TableMove.tableId` FK — **resolved by Tier G commit 6 (2026-05-20); see the Resolved-by-Tier-G-commit-6 entry below.**

**Partially resolved by Tier I commit 2 (2026-05-16):**
- **§8.2 Table moving / combining — drag UI + override modal landed on Live.** I1 shipped the data model + endpoints (zero UI); I2 wires the drag UX, the merged-card render, and the party-too-large override modal. I3 (calendar propagation + edge polish) is still pending.
  - **Live page two-pass render** (`apps/restaurant/app/dashboard/live/page.js`):
    - Pass 1a: each active merge group with a rectangular bounding box (members.length === rowSpan × colSpan) renders as a SINGLE spanning button via CSS `gridColumn: span N / gridRow: span N`. Amber border + ★ label + `combinedLabel + summedSeats` header derived from `/layout/live`'s merge sub-object (shipped in I1).
    - Pass 1b: non-rectangular (L-shaped) merge groups fall back to per-member cards sharing the same amber border treatment, with the combined label on the topmost-leftmost member only. Avoids the spanning card claiming a "phantom" empty corner cell.
    - Pass 2: standalone tables + empty placeholders iterate the row-col grid as before, **skipping cells already claimed by a merge in pass 1**. Defends the "exactly one merge group OR one standalone table owns each cell" invariant from the audit.
    - All cards keep `min-h-[80px]`. The drag handle (⠿ glyph, 14px) sits in the top-right corner of standalone cards next to the existing seat-count chip — within the 80px budget per `memory/waiter_ux_strategy.md` §3.7 invariant.
  - **Drag flow**: native HTML5 `draggable` on the handle span only (NOT the whole card, decision 5) — `stopPropagation` on `onClick`/`onMouseDown` so the card's tap-to-popup gesture isn't hijacked. `onDragOver` on the target cell does the adjacency + 4-cap pre-check client-side (server still enforces); valid targets get an amber ring hint; invalid targets get the not-allowed cursor (default `dropEffect` not set). `onDrop` composes the union of (source's existing merge ∪ source standalone) + (target's existing merge ∪ target standalone) and POSTs to `/api/restaurant/tables/merge`. Reservation-bound when in confirm-mode (passes `reservationId` + reservation's time/endTime); else uses now→end-of-business-day default window.
  - **5th-merge attempt blocked client-side** in `onDragOver` and `onDrop` (sourceCount + targetCount > 4 → no preventDefault, no POST). Server's 400 `merge-cap-exceeded` stays the authoritative defense.
  - **Socket integration**: subscribes to `table:merged` + `table:unmerged` and triggers a quiet `loadLayout(true)` on either. The existing C4 `useSocketRefetch` covers reconnect/tab-focus, so the merged-card state stays consistent across the §4.4 freshness model.
  - **Popup `ReservationDetailPopup`** extended:
    - When `current.merge?.isActive`, an amber sub-header chip renders below the existing title showing the combined label + summed seats.
    - The `popupActions.actionsForStatus` payload-keyed branch (same pattern E1 added for `MODIFICATION_PENDING`) appends `unmerge` to the action set on merged cards. Suppressed on terminal states (COMPLETED/CANCELLED/NO_SHOW) and on OCCUPIED (merges auto-deactivate when the bound reservation completes — staff shouldn't split mid-service).
    - New `unmerge` ActionButton variant (amber tone matching the merge callout) wired to PUT `/api/restaurant/merges/:groupId/unmerge` with toast on success.
  - **Override modal** (`apps/restaurant/components/OverrideModal.jsx`, standalone per decision 7): triggered when `PUT /reservations/:id/assign-table` returns 409 `party-too-large`. Reads `tableLabel`, `seatCount`, `partySize` from the I1 structured-body shape; localized confirm copy via i18n. "Assign anyway" re-POSTs with `force: true`. "Cancel" closes the modal, no backend call, confirm-mode stays open.
  - **~16 new i18n keys** under `merge.*` (handleTooltip, error{NotAdjacent,Cap,Occupied,WindowConflict,ReservationConflict,CrossSection,Generic}, headerLabel, memberOf, mergedToast, unmergedToast, etc.) + `override.*` (title, body, confirm, cancel, assigning, successToast) + `actions.unmerge`. RO + EN parallel.
  - **C6 popup-actions Node smoke extended** with scenarios J/J'/J''/J''' covering: merge appended on CONFIRMED, merge suppressed on OCCUPIED, stale (`isActive=false`) merge ignored, modification-pending wins over merge. **19/19 PASS**.
  - **Backend regression battery all green** (no backend code changed in I2): Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12.
  - **Cowork QA fixture** at `server/scripts/seed-tieri-qa-fixture.js` creates a contiguous 3×3 `[Tier I QA]` section at La Mama with 9 adjacent tables (TI-1…TI-9), since the demo seed's Interior section spaces tables at 2-cell intervals (no Manhattan-1 adjacencies). Re-runnable, cleaned up via the Tier F2 admin section delete.
- **Decision implications surfaced during I2:** L-shape merges fall back to per-member cards (not a spanning rectangle that would claim a phantom corner). The spec is silent on shape; this is the cleaner default.
- **Fix-the-fix (2026-05-16):** three findings from Cowork's I2 browser QA closed before I3 starts.
  - **Blocking — OverrideModal unreachable from confirm-mode**: the Live cell render hard-disabled every non-eligible table in `/dashboard/live?confirmReservationId=…`, so clicks on too-small tables didn't fire and the override path had no UI entry. Refactored the eligibility split: `hardDisabled` now only covers `OCCUPIED + OUT_OF_SERVICE` (truly not assignable even with override); `softIneligible` covers in-confirm-mode + `!isEligible` + party-doesn't-fit (table.seatCount < confirmReservation.partySize OR merge.summedSeatCount < partySize). Soft-ineligible tables stay clickable, render with dashed orange border + bg-orange-50/60 tint + a "click to override" tooltip; click routes through the existing assign-table path → 409 `party-too-large` → OverrideModal opens. The third bucket — `conflictIneligible` (table large enough but already booked in the slot) — stays hard-disabled because there's no override path for time-conflict today. Same logic applied to the merge spanning card. Defensive source-grep confirmed no other call sites hard-disable confirm-mode cards.
  - **Cosmetic — false "Auto-confirmed" status chip on synthetic-merge popups**: when the popup opens on a merge with no bound reservation, the Live page synthesizes a placeholder reservation (id: null, status: 'AUTO_CONFIRMED') so the popup can render its header + Unmerge action. The status chip rendered that synthetic status as "Auto-confirmed" — a false claim about a non-existent reservation. Suppressed via `isSyntheticMerge = hasActiveMerge(current) && current.id == null`; in its place a neutral amber chip reads "Merged tables · no current reservation" / "Mese unite · fără rezervare curentă".
  - **Cosmetic — merge popup "Table" field showed lead member name**: the body's Table detail rendered `tableLabel` (= the lead member's `tableNumber`, e.g. "TI-1") instead of the combined label that already lives in the header chip. Switched to `displayTableLabel = hasActiveMerge(current) ? current.merge.combinedLabel : tableLabel` so the body matches the header ("TI-1+TI-2").
  - **QA debris cleanup**: reservation `b1bd28c3-0836-46b5-b6fe-cfa52b201f22` (party of 10, force-assigned to TI-1) routed through `PUT /restaurant/reservations/:id/cancel` → CANCELLED; section `481f2692-d0c5-4466-8aac-f63b11a2f1be` ("[Tier I QA]") routed through `DELETE /admin/sections/:id` → 200 with `tablesRemoved: 9`. **Workaround surfaced a real backend bug**: `TableMove.tableId` FK to `RestaurantTable` defaults to RESTRICT, so the Tier F2 section-delete cascade FK-fails when QA tables have TableMove history. Pre-Tier-I, TableMove rows were never written so the latent issue didn't bite. **Schema fix (set `onDelete: Cascade` on `TableMove.table`, `SetNull` on `mergedWithTable` and `reservation`) — applied by Tier G commit 6 (2026-05-20) via `prisma db push --accept-data-loss`; see the Resolved-by-Tier-G-commit-6 entry below.** Cleanup script `server/scripts/cleanup-tieri-qa.js` works around it by hand-deleting the TableMove rows before invoking the F2 endpoint.
  - All regressions stay green after the fix-the-fix: C6 popup-actions 19/19, Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12.
- **Fix-the-fix #2 (2026-05-17):** Cowork browser QA caught a renderer hang on the next interaction after the first confirm-mode render — clicking a section tab or any subsequent state change froze the renderer for 45s+ (Chrome extension reported "renderer may be frozen or unresponsive"; CDP Runtime.evaluate timed out). Reproduced on fresh tabs.
  - **Root cause analysis (best inference; no live repro available since Cowork drives Chrome and the freeze blocks DevTools).** The render path on `apps/restaurant/app/dashboard/live/page.js` had an IIFE inside the JSX (`(() => { ... })()`) that rebuilt the merge-group `Map`, `claimedCells` `Set`, bounding-box math, and L-shape detection on EVERY parent render. That includes renders triggered by `dragHover`, `overrideInfo`, popup open/close, the 30s tick — none of which affect merge layout. Combined with per-cell `t()` translation lookups and inline-arrow `onDragOver`/`onDragLeave`/`onDrop` handlers (new function references each render, causing React to re-attach the per-cell listeners), the per-interaction render cost compounded under React 18 concurrent rendering enough to manifest as a hang in dev/strict-mode.
  - **Fix.** Three-part:
    - Extracted the merge-layout computation into a pure, framework-free helper at `apps/restaurant/lib/liveGridLayout.js` (`computeLiveGridLayout(tables, liveByTableId)` → `{ mergeGroups, claimedCells }`).
    - The Live page now wraps it in `useMemo` keyed on `[tables, liveByTableId]` so `dragHover` / `overrideInfo` / popup state changes don't recompute.
    - `useCallback` on `handleDragStart` / `handleDragEnd` / `handleDragOver` / `handleDragLeave` so per-cell drag handlers don't change identity each render.
    - Hoisted per-cell tooltip translations (`t('merge.handleTooltip')`, `t('override.tinyHint')`) once per render instead of per cell.
    - The helper returns mergeGroups sorted deterministically by `groupId` so React `key` stability holds across renders.
  - **Perf guard.** New Node smoke `server/.smoke/c6-live-grid-layout-test.js` (18/18 PASS) asserts: (a) purity — same input → same output across two calls; (b) rect vs L-shape detection (no phantom corner cell on L-shapes); (c) inactive merges filtered; (d) deterministic groupId ordering for React `key` stability; (e) empty-case fast path; (f) **O(N) perf budget** — 1000 tables × 250 merges completes in <50ms (measured 1.18ms). This catches the regression class as a smoke fail rather than a 45-second browser hang.
  - **Cleanup.** Cowork's QA debris (reservation `ddef5ce5-...` and section `02b4a90f-...`) routed through the canonical cleanup script — reservation CANCELLED, section + 9 tables hard-deleted via the F2 endpoint (with the TableMove pre-purge workaround for the FK known issue documented in the prior fix-the-fix entry).
  - **Regressions all green**: C6 popup-actions 19/19, Tier I1 12/12, Tier E1 31/31, Tier E2 33/33, Tier F2 24/24, Tier D2 22/22, C1 dispatcher 12/12, + new c6-live-grid-layout-test 18/18.
- **Fix-the-fix #4 (2026-05-17):** Cowork manual QA found that clicking a soft-ineligible card in confirm-mode surfaced a raw `window.alert("Failed to assign table: Party of 10 doesn't fit TI-1 (2 seats). Pass { force: true } to override.")` instead of opening the localized OverrideConfirmModal — the override flow wasn't round-tripping end-to-end despite all the prior fix-the-fixes. **Root cause**: the restaurant app's `apps/restaurant/lib/api.js` `handleResponse` threw a bare `new Error(msg)` without attaching `err.payload` + `err.status`. The live-page catch at `handleAssignFromConfirm` reads `err?.payload?.error?.code` — always undefined for restaurant calls → branch always missed → fell through to `alert()`. The admin app's `lib/api.js` got the payload attachment in Tier F2 (for the `shrink-orphans-tables` 409 + `section-has-reservations` 409 surfaces); the restaurant equivalent was never patched. **Fix**: mirror the admin pattern in `apps/restaurant/lib/api.js` (attach `err.status = response.status` + `err.payload = data` in the !ok branch). One-line semantically; defensive infrastructure that benefits any future structured-error handling on the restaurant side. **Source-grep sweep** across `apps/restaurant/` for `assign-table` PUTs found exactly ONE site — `live/page.js:182` (the `handleAssignFromConfirm` in confirm-mode). The popup's `reassignTable` action variant forwards via `onAction` but the Live page's `onAction` just closes the popup + refetches, not a PUT — so no second wiring site to fix. **New defensive smoke** at `server/.smoke/c6-assign-table-override-wiring-test.js` (14/14 PASS): static source-grep that `apps/restaurant/lib/api.js` retains the `err.payload = data` + `err.status = response.status` attachments + end-to-end runtime assertion that `PUT /assign-table` on a party-too-large condition returns 409 with `error.code === 'party-too-large'` AND the simulated api.js convention populates `err.payload.error` correctly. **Override flow now round-trips end-to-end** — click soft-ineligible → 409 → OverrideConfirmModal opens with localized copy → Confirm re-POSTs with `{ force: true }` → 200 + success toast. The fallback `alert()` at `live/page.js:203` remains as the catch-all for unexpected errors (network failures, 500s) — that's not the override path and is out of this fix's scope. Regressions all green.

**Resolved by Tier E commit 2 (2026-05-16):**
- **§5.6 diner-side modification request flow + Keep/Cancel reject-handling on mobile.** Tier E is now fully complete (§6.5 restaurant side resolved by E1; §5.6 diner side resolved here).
  - **1 new endpoint:** `POST /api/reservations/:id/modifications/:modId/ack` body `{ action: 'keep' | 'cancel' }`. 4 error codes: `invalid-action` (400, body not in {keep,cancel}), `modification-not-rejected` (400, mod still PENDING or already APPROVED), `modification-already-acknowledged` (400, idempotent guard), `forbidden` (403, requesting diner doesn't own the reservation). 404 for `reservation-not-found` / `modification-not-found`. On `keep`: stamps `acknowledgedAt`, reservation untouched, `reservation:updated` to `user:{id}` with `modificationRejected: null`. On `cancel`: in a single `prisma.$transaction`, stamps `acknowledgedAt` + flips Reservation to CANCELLED with `cancelledBy='user'` (mirrors the existing `PUT /:id/cancel` handler field-for-field), then fires `RESERVATION_CANCELLED_BY_DINER` (event #9) + emits `reservation:cancelled` to both restaurant and user rooms.
  - **3 new validations on `POST /api/reservations/:id/modify`** that mirror what `POST /reservations` enforces — pre-Tier-E the modify path was a softer surface where a diner could request a date in the past, on the restaurant's disabled list, or outside opening hours:
    - `date-in-past` (400, effective requested date < today Bucharest)
    - `date-not-available` (400, effective date on the restaurant's `DisabledDate` list)
    - `time-outside-hours` (400, effective time outside the matched `OpeningHours` window for the effective date's weekday)
  - **Drive-by bug fix:** `POST /reservations` and the modify validations now share a `timeMinutesFitsOpenWindow(time, open, close)` helper that handles cross-midnight close times (`closeTime='00:00'` represents the next-day midnight = 24:00). Pre-fix a 20:00 reservation at La Mama (open 10:00→00:00 Saturday) would 400 because the raw parser treated 0 < 1200. Both call sites use the helper now so they don't drift.
  - **`GET /api/reservations/mine` + `/api/reservations/:id` reshaped:** each row now carries `modificationPending: row | null` and `modificationRejected: row | null` (the latter filtered to status=REJECTED + `acknowledgedAt: null`). Lets the mobile list + detail screens render the inline banner without a separate fetch. `/:id` additionally adds `specialRequests` to the select for the detail screen.
  - **Mobile UI:**
    - New `apps/mobile/src/screens/ReservationDetailScreen.js` reachable from each `ReservationsScreen` card tap. Renders cover photo (via `mediaUrl()`), status badge, DD-MM-YYYY date, HH:mm time, party, table label, special requests. Action bar at the bottom with `Request a change` (visible when status ∈ {PENDING/CONFIRMED/AUTO_CONFIRMED} AND no pending/rejected mod) and `Cancel reservation` (modal-confirmed). Live socket sync via `subscribe('reservation:updated'/'reservation:cancelled')` re-loads on staff actions.
    - New `apps/mobile/src/screens/RequestChangeScreen.js` — three optional fields (date / time / party-size stepper) defaulted to current values. Submit button shows `Change at least one field` until at least one differs from current. POST sends only the changed fields (omits equal-to-current). On success, transitions to a Pending state view ("We've sent your change request… You'll get a notification") with a Done button. Surfaces the 6 backend error codes as localized inline copy. Mirrors the BookReservationScreen disabled-date gray-out for the date picker.
    - `ReservationsScreen` cards now tap → `ReservationDetail` (was no-op). When `modificationRejected != null && acknowledgedAt == null`, renders an inline amber banner with `Keep` + `Cancel` buttons that call the ack endpoint directly; `Cancel` confirms via native Alert before firing. `e.stopPropagation()` on the banner buttons so card-tap doesn't fire underneath.
  - **Both AppNavigator routes** added under AppStack: `ReservationDetail` + `RequestChange`.
  - **~25 new i18n keys** across `apps/mobile/src/locales/{ro,en}.json`: `reservationDetail.*` (14 keys), `modify.*` (11 keys), `modRejected.*` (10 keys), `errors.*` (7 keys). RO primary.
  - **End-to-end backend smoke 33/33 paths green** (`server/scripts/smoke-tiere2.js`): seed CONFIRMED → POST modify → staff reject → ack keep → reservation untouched + acknowledgedAt set; second POST modify succeeds (E1 guard releases on acknowledged rejection); staff reject → ack cancel → reservation CANCELLED + `cancelledBy='user'` + dispatcher event fires; the four ack failure paths (`invalid-action` / `modification-not-rejected` / `modification-already-acknowledged` / `forbidden` 403); the three modify validation paths (`date-in-past` / `date-not-available` / `time-outside-hours`); and a sanity check that the RO `MODIFICATION_REJECTED` template still says "Vrei să păstrezi rezervarea originală?".
  - **Regression battery all green:** Tier E1 smoke 31/31; Tier F2 24/24; Tier D2 22/22; C6 popup-actions 15/15; C1 dispatcher 12-event template render 12/12. Source-grep on the new mobile screens for hardcoded UI copy is clean — only `Alert.alert('Error', ...)` titles and 1-word day/month label glyphs remain, matching the pre-existing convention on `BookReservationScreen`/`ReservationsScreen`.
  - **Real-device QA:** the diner side runs in Expo's runtime and can't be driven from Cowork's Chrome surface. Sebastian will scan the Expo QR on his phone and run book → request change → curl-as-staff to reject → see banner → Keep, then repeat with Cancel.

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
- **Shared infrastructure components landed** in `apps/restaurant/components/`. Each component was standalone-verified via a `/dashboard/phase2-demo` harness route (never linked from the sidebar; removed in Tier H commit 1). Components are not yet wired into the real pages — that's Phase 3.
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
- **Schema additions (2026-05-09):** `User.expoPushToken` (text, nullable) added; old `User.fcmToken` kept as a deprecated column with no readers — **dropped in Tier G commit 7 (2026-05-20); see the Resolved-by-Tier-G-commit-7 entry below.** `Reservation.reminderSentAt` (timestamp, nullable) added. Both pushed to Railway with no data-loss prompt — purely additive. `PUT /api/users/me/fcm-token` renamed to `PUT /api/users/me/push-token` with body field `expoPushToken`; mobile-side wiring lands in a later tier.

**Resolved by Tier G commit 2 (2026-05-20):**
- ~~§3.1 +40 phone format not validated.~~ Romanian `+40`-and-9-digits enforcement now covers every diner/guest phone DB-write path. Shared `server/src/lib/phoneValidation.js` exports `ROMANIAN_PHONE_RE` (`/^\+40\d{9}$/`), the canonical `PHONE_FORMAT_MSG`, and `phoneFormatErrorBody()` which maps a format failure to the structured `{ error: { code: 'invalid-phone-format', message } }` contract (Tier E/F shape — mobile UI localizes it). Four write sites: `POST /api/auth/register` (regex pre-existed; now emits the structured code), `PUT /api/users/me` diner profile update (same), `POST /api/restaurant/reservations` staff-created `guestPhone` (regex newly added — was `notEmpty` only; `.bail()` keeps a missing phone reporting "required" not the format error), `PUT /api/restaurant/reservations/:id` staff edit `guestPhone` (regex newly added — was unvalidated). Restaurant-entity phone fields (admin onboarding, restaurant Manage-Profile contact) deliberately untouched — §3.1 governs diner phone, a venue line may be a landline. Reads never re-validated; legacy non-conforming rows untouched.
- ~~§9.3 "most free neighbors" preference missing.~~ When more than one exact-seat-match table is free for an auto-confirm, the picker (`server/src/routes/reservation.routes.js`) now ranks candidates by free Manhattan-1 same-section neighbor count and picks the highest (combining flexibility per §8.2). New helper `countFreeAdjacents(table, allTables, busyTableIds)` in `server/src/lib/tableMerges.js`. A single free candidate is picked unchanged (no extra query). `eligible-tables` / `/availability` / mobile availability keep `gte` semantics — they answer "what fits at all", not the auto-confirm pick.
- ~~§3.2 30-day reservation pruning job missing.~~ New `server/src/jobs/pruneOldReservations.js` hard-deletes reservations whose calendar date is strictly more than 30 days past AND whose status is terminal (COMPLETED / NO_SHOW / CANCELLED). Non-terminal statuses and rows inside the 30-day window are explicitly excluded; idempotent. Bootstrapped from `server/src/index.js` on its own 24h `setInterval` (runs once at boot) — deliberately off the minute-tick `socket/handlers.js` loop so a failure can't stall the table-status jobs.
- New smokes: `server/.smoke/g-auto-confirm-picker-test.js` (11/11 — exact-match preference, fall-through to PENDING, free-neighbor tiebreak, against a throwaway seeded restaurant) and `server/.smoke/g-prune-old-reservations-test.js` (5/5 — terminal@-31d pruned, non-terminal@-31d kept, terminal@-29d kept, idempotent re-run).

**Resolved by Tier G commit 3 (2026-05-20):**
- ~~§6.7 staff-side photos and menu PDF upload missing.~~ Five staff endpoints added under `/api/restaurant` in the new `server/src/routes/restaurantUploads.routes.js` (Option A — duplicate endpoints, not re-keyed admin ones): `POST /photos`, `DELETE /photos/:photoId`, `PUT /photos/:photoId/cover`, `POST /menu`, `DELETE /menu`. All `authenticateRestaurant`-gated; restaurantId is always JWT-derived (never a path/body param). Photo delete/cover verify ownership of the targeted `photoId` and return 403 `forbidden` on a cross-tenant attempt. multer config + file-type/size validation stay single-sourced in `lib/uploads.js` — its multer destination now reads `req.uploadRestaurantId || req.params.id`, so the same uploaders serve both admin (`:id` path param) and staff (JWT) routes. Restaurant-side `PhotosSection`/`MenuSection` components (ported from the admin twins) are mounted on the Settings page; `apiUpload` + `uploadUrl` added to `apps/restaurant/lib/api.js`; `photoUpload.*` + `menuUpload.*` i18n keys added (RO + EN).
- ~~§7.6 auto-confirm toggle UI in restaurant Manage Profile.~~ The toggle already existed on the Settings page and already called `PUT /api/restaurant/settings` — and that route **already existed** (a minimal handler accepting only `autoConfirmEnabled`). The Tier G commit-1 audit entry that flagged this as a "silent bug / route not mounted" was **mistaken** — the audit agent missed the existing route; the toggle was working. G3 nonetheless **expands** `PUT /api/restaurant/settings` to the full §6.7 self-service whitelist: `autoConfirmEnabled, descriptionRo, descriptionEn, phone, email, website, openingHours, servicePeriods`, with a strict unknown-field guard (any other field, including a forged `restaurantId`, → 400 `unknown-field` + the offending field name), `+40` phone validation (structured `invalid-phone-format`), and a GET /profile-shaped response. The Settings page profile-save (`handleSaveProfile`) is rewired from `PUT /profile` to the comprehensive `PUT /settings`, so the contact phone is now +40-validated. `openingHours`/`servicePeriods` write logic is shared with the admin restaurant-edit endpoint via the new `server/src/lib/restaurantProfile.js` so the two can't drift. The legacy minimal `PUT /profile` route is left mounted but is no longer used by the Settings page.
- New smoke: `server/.smoke/g-restaurant-settings-test.js` (26/26 — PUT /settings happy / unknown-field / invalid-phone-format / forged-restaurantId; staff photo POST + cover + DELETE; cross-tenant 403 on another restaurant's photo + cover; staff menu POST + DELETE). Tier F1 admin photo/menu smoke re-verified for non-regression after the `lib/uploads.js` refactor.

**Resolved by Tier G commit 5a (2026-05-20):**
- ~~§5.1 Location filter on mobile home.~~ `apps/mobile/src/screens/HomeScreen.js` gains a "Nearby" chip in a filter row above the cuisine chips. Tapping it requests `expo-location` foreground permission — **only on that explicit tap**, never on render; Expo caches the grant so an already-granted user is not re-prompted — then fetches the current GPS position and sends `lat`/`lng` on the `GET /restaurants` query. The backend's existing Haversine sort orders the list by distance, and the per-card "X away" hint (already coded but previously dormant since `distance` was never returned) goes live. On permission denial / GPS failure the filter stays off and a localized hint is shown ("Enable location to sort by distance"). `expo-location@~19.0.8` was already a dependency — no install needed. 6 new i18n keys under `homeFilters.*` (RO + EN), including the now-localized distance hint. Party-size / date / time filters shipped in **G5b** — see the entry above.

**Resolved by Tier J commit 1c (2026-05-20):**
- ~~45-min reminder push missing its `categoryId` (the J1b follow-up).~~ `channels/push.js` now attaches `categoryId: 'reservation-reminder'` to the outbound Expo push message — but only for the `RESERVATION_REMINDER_45` event (guarded by `eventKey === EVENTS.RESERVATION_REMINDER_45`); every other event has no notification actions and carries no categoryId. This lets the mobile app's J1b-registered `reservation-reminder` category render the §5.7 Yes/No action buttons. The message build was extracted into a pure exported `buildExpoMessage()` so the categoryId logic is smoke-assertable without a network call (`j1b-push-token-test.js` `[g]`, 11/11). §5.7's reminder is now complete end-to-end.
- ~~SMS deferral was documented only in a code comment.~~ Promoted to a formal §14 Decisions-log entry ("2026-05-20: SMS transport deferred to v1.1"); §10 carries a launch-status note; `channels/sms.js`'s header comment now back-references the §14 entry; and it is logged below under v1.1 known gaps.

**Resolved by Tier J commit 1b (2026-05-20):**
- ~~§5.7 / §10 — mobile push notifications never reached devices (the launch blocker).~~ The Tier-J spec walk found the backend push pipeline (dispatcher, Expo Push transport `channels/push.js`, 45-min reminder job — all Tier C3) was complete, but the mobile app never obtained or uploaded a push token, so every `User.expoPushToken` stayed null and every diner push silently no-op'd. §14 explicitly deemed push too critical to defer, so this was the one true launch blocker. J1b closes it: `expo-notifications@~0.32.17` installed (SDK 54); new `apps/mobile/src/lib/pushNotifications.js` — sets the foreground notification handler, registers an Expo push token (permission check → request only if undetermined → `getExpoPushTokenAsync` → `PUT /api/users/me/push-token`, with a SecureStore token-cache so rotation re-POSTs but a stable token doesn't), and exposes the §5.7 reminder response listener. `registerPushToken()` fires fire-and-forget from `AuthContext` on login, register, and cold-start `checkAuth` (the cold-start path catches a diner who granted permission via system Settings without re-logging-in). `App.js` registers the `reservation-reminder` notification category (Yes/No action buttons, i18n labels) + the response listener (`actionIdentifier==='no'` → `PUT /reservations/:id/cancel`; Yes / plain tap → no-op). Denied permission / offline Expo backend / failed POST are all swallowed — never crash, never block login, retried next start. 4 i18n keys (`push.*`, RO + EN). New smoke `server/.smoke/j1b-push-token-test.js` (9/9 — re-verifies the C3 path: `PUT /me/push-token` populates + rotates the column, empty→400, `sendPush` skips on no/bad token and runs the transport on a valid one). **Remaining (small follow-up):** the inline reminder Yes/No buttons render only if the server reminder push carries `categoryId: 'reservation-reminder'` — `channels/push.js` does not yet send it, so the reminder currently delivers as a tappable title/body without the inline buttons. The mobile category + listener are already wired for it; needs a ~1-line server addition. Push **delivery** — the actual blocker — is fixed.

**Resolved by Tier J commit 1a (2026-05-20):**
- ~~§5.3 diner "Special requests" field missing on the mobile booking flow.~~ The Tier-J spec-compliance walk found this had fallen through the cracks — the §15 entry was commented-out as if resolved ("diner-side field still pending Tier D") but Tier D never built it. J1a closes it: `apps/mobile/src/screens/BookReservationScreen.js` step 1 gains an optional multi-line "Special requests" input (`maxLength` 500 — a new diner-side cap; the staff popup `<textarea>` has no explicit limit), and `handleBook` sends `specialRequests` on `POST /api/reservations`. The backend route was extended to accept it (`body('specialRequests').optional({nullable:true}).isString().trim().isLength({max:500})`, stored trimmed-or-null on the reservation row; the J-walk found the route did NOT previously read it despite the field being assumed wired). Round-trip verified: a diner POST with `specialRequests` → the persisted row carries it → `GET /api/restaurant/reservations` returns it in the row shape → the staff ✦ badge + popup body field (C6 P3-9) light up. 2 i18n keys added (`book.specialRequestsLabel/Placeholder`, RO + EN). New smoke `server/.smoke/j1a-special-requests-test.js` (13/13). No schema change — the `specialRequests` column has existed since Tier B.

**Resolved by Tier H commit 3 (2026-05-20):**
- ~~Palette token sweep — status / action / feedback colors formalized in the shared theme source-of-truth.~~ `packages/shared/theme/colors.js` gained **33 web tokens** in `tailwindColors` (consumed by both Next apps via `theme.extend.colors`) + **4 mobile tokens** in `Colors`: status-badge tints (`status-{pending,confirmed,awaiting,occupied,cancelled,noshow,neutral,info}-bg/-fg`, 16), alert-banner trios (`alert-{error,success,warning}-bg/-border/-fg`, 9), action-button fills (`action-{danger,info,success,warning}` + `-hover`, 8), mobile feedback-banner tints (`warnTint`/`warnTintBorder`/`warnTintBorderSoft`/`warnTintText`). **55 consumer usages migrated across 22 files** — NextZone's `STATUS_TONE` map + the Reservations page's `statusBadgeColor` map + inline status chips (ReservationDetailPopup, admin team / restaurants) → `status-*`; ~14 inline alert banners + 2 ReconnectingBanners → `alert-*`; `ActionButton` VARIANT_STYLES (reject/seat/complete) + ~15 inline solid action buttons → `action-*`; 18 mobile inline hex → `Colors.*`. Token hex values were sampled 1:1 from the Tailwind classes they replace, so the render is colour-identical by construction — two intentional shade-unifications aside: the Reservations-page Reject/Seat buttons were `bg-red-500`/`bg-blue-500` (one shade lighter than `ActionButton`'s 600 family) and now match the shared `action-danger`/`action-info` token; the Reservations COMPLETED badge text shifts gray-800→gray-700 to share `status-neutral-fg`. `bg-sidebar` was already a token (Cluster D — no change). Existing `primary`/`table-*`/`res-*`/`error`/`warning`/`info` tokens left untouched. Pure theme + consumer rewrites — no schema, backend, or test changes.

**Resolved by Tier H commit 4 (2026-05-20):**
- ~~§6.4 Calendar amended to the locked v1.1 role — past + future planning view; today owned by Live.~~ Three behaviors landed in `apps/restaurant/app/dashboard/calendar/page.js`: (1) **today→Live redirect** — when the resolved date equals today (Europe/Bucharest), the page `router.replace('/dashboard/live')` and renders nothing in between (`replace`, not `push`, so Back can't trap on Calendar-today); (2) **date-picker default is tomorrow** — `?date=` URL param still wins for shareable links / Quick Add's date-prefill; (3) **past dates render read-only walk-in segments** — amber fill spanning `[startedAt, endedAt]` in 15-min increments, labelled `{name} × {N}` or `Walk-in × {N}`, alongside reservation blocks at their final statuses. Empty past-date cells are inert (no Quick Add — you can't book in the past; cursor is `default` not `pointer`); reservation cells stay clickable for inspection (`popupActions` already returns `[]` for COMPLETED/NO_SHOW/CANCELLED, so the popup is correctly view-only — audited, no change needed). New backend endpoint `GET /api/restaurant/walk-ins?date=YYYY-MM-DD` returns walk-in `TableActivity` rows for a past date and `[]` for today/future (today is Live's domain, future has none). No schema change — `TableActivity` (C6 Phase 1) and `walkInName` in `TableActivity.notes` (C6 P3-4) already exist. New smoke `server/.smoke/h4-calendar-walkins-test.js` (16/16). OOS-history rendering on past dates is intentionally **not** included — logged as a v1.1 gap under "Polish (deferred)" below.

**Resolved by Tier H commit 2 (2026-05-20):**
- ~~§6.3 / §6.4 service-period filter on the Calendar.~~ The `ServicePeriodFilter` shared component (built in Tier G commit 4 for the Live floor plan) is now mounted on the Calendar page (`apps/restaurant/app/dashboard/calendar/page.js`) as the 3rd control in the existing Controls row, beside Date + Section. The Calendar fetches `servicePeriods` once from `/api/restaurant/profile` (same pattern as Live) and holds a `selectedPeriodId`; with a period selected, a reservation's guest chip renders only when its start time falls inside the period window. Filter is visual-only — `res` still drives cell-click routing, so a period-hidden reservation is never mistaken for a free slot (identical to Live's overlay-suppression behavior). "All periods" is the default. The `timeInPeriod()` window helper was extracted from `live/page.js` into the shared `apps/restaurant/lib/servicePeriod.js` — one source of truth, both pages import it (the precedent Tier G commit 5b set). No backend, schema, or test changes.

**Resolved by Tier H commit 1 (2026-05-20):**
- ~~`§15`-marker tombstone comments stripped + `phase2-demo` harness route removed.~~ The four "X removed — SPEC §Y" tombstone comment blocks (Phone OTP §3.4 in `auth.routes.js`; Waitlist routes §6.6 in `restaurantPlatform.routes.js`; Analytics §7.4 and Billing §7.5 in `admin.routes.js`) were kept through Tiers E/F/G as audit aids; with the §15 backlog now drained they were deleted. The `delete-marker at …` line-number citations in the Tier-G-commit-1 housekeeping entries below therefore no longer resolve to anything — the removals themselves remain documented (here and in those entries). The `BillingReport` Prisma-model retention noted in the billing tombstone is independently recorded in `server/prisma/schema.prisma`, so its comment carried no unique information. Also removed the `apps/restaurant/app/dashboard/phase2-demo/page.js` dev/demo harness route (never linked from any sidebar or router — Tier C6 Phase 2 standalone-verify scaffold that outlived its purpose). Pure cleanup — no schema, route-behavior, or test changes.

**Resolved by Tier G commit 7 (2026-05-20):**
- ~~Two deprecated dead columns dropped — `Reservation.fromWaitlist` (`from_waitlist`) and `User.fcmToken` (`fcm_token`).~~ `from_waitlist` was a default-`false` leftover of the waitlist system cut per SPEC §6.6; `fcm_token` was a leftover of the C3 push-transport rename to `expoPushToken`. A full workspace source-grep (`server/`, `apps/`, `packages/`) confirmed **zero code readers** of either column (the only hits were the two schema-field definitions themselves and doc/comment references). Both dropped in one migration applied to Railway via `npx prisma db push --accept-data-loss`: the `from_waitlist` drop carried the expected data-loss notice (44 non-null rows — all the column's `false` default, no real signal); the `fcm_token` drop was clean (all-NULL). Prisma Client v5.22.0 regenerated cleanly. The §10 push-notification pseudo-code that still referenced `user.fcmToken` was corrected to `user.expoPushToken` in the same commit. This closes the last two deferred schema-cleanup items in §15 — **Tier G is complete end-to-end (G1 → G7).**

**Resolved by Tier G commit 6 (2026-05-20):**
- ~~`TableMove` FK cascade bug (deferred from Tier I commit 2 fix-the-fix).~~ All three `table_moves` foreign keys defaulted to `RESTRICT`. Pre-Tier-I no `TableMove` rows were ever written, so the Tier F2 section-delete cascade worked; once Tier I wrote real merge rows, deleting a section that cascaded into tables with move history FK-failed (`23001`). Fixed by redefining the three FKs (migration applied to Railway via `npx prisma db push --accept-data-loss` — Prisma classifies any FK redefinition as destructive, but no columns are dropped and no rows are touched; it only corrects cascade semantics): `table_moves_table_id_fkey` → `ON DELETE CASCADE` (a deleted table drops its move rows), `table_moves_merged_with_table_id_fkey` and `table_moves_reservation_id_fkey` → `ON DELETE SET NULL` (a deleted merge-partner / reservation leaves the historical move row intact). This obsoletes the `server/scripts/cleanup-tieri-qa.js` pre-purge workaround written during the Tier I3 cleanup — **removed in this commit** (source-grep confirmed zero callers / npm-script references; it was always a one-off manual script). Verified functionally: a smoke section + table + a `TableMove` row tied to that table, then `DELETE /api/admin/sections/:id` → 200 with the section, its tables, AND the `TableMove` rows all cascade-deleted automatically. New case `[j]` added to `server/scripts/smoke-tierf2.js` (now 10 paths) covers exactly this.

**Resolved by Tier G commit 5b (2026-05-20):**
- ~~§5.1 party-size / date / time filters on the mobile home.~~ `GET /api/restaurants` accepts three new optional query params — `partySize` (int 1–30), `date` (`YYYY-MM-DD`, today-or-future in Europe/Bucharest), `time` (`HH:mm`, 15-min granular). **All-or-none:** the availability filter engages only when all three are present; any subset is ignored and the list behaves exactly as before. The pre-existing `search`/`cuisine`/`lat`/`lng` params are unchanged and compose with the new ones. When engaged, a restaurant is kept only if it could seat the party for the requested **120-minute window** — open at that time (cross-midnight-aware), inside a service period if the day has any, not a disabled date, and with either a single free table seating ≥ partySize **or** a feasible adjacent merge of free tables summing to ≥ partySize. Every per-restaurant lookup is batched (5 queries, not 5×N). Validation emits the structured `{ error: { code } }` contract: `invalid-party-size`, `invalid-date`, `date-in-past`, `invalid-time`. The join is biased toward false positives — a stale row that turns out unbookable is an accepted race (the diner sees an honest "no tables" on the actual booking attempt); a false negative (hiding a bookable venue) is the worse failure, so the single-table check uses `≥` not exact seat-match. **Shared-helper extractions (one source of truth, zero drift):** `computeMergeSuggestions` moved from `restaurantPlatform.routes.js` into `lib/tableMerges.js` and gained an optional pre-fetched `conflictSet` arg so the batched join skips its per-call reservation query (staff `/availability` call site unchanged); `timeMinutesFitsOpenWindow` moved from `reservation.routes.js` into the new `lib/openingHours.js`, which also adds `timeWithinServicePeriods`. Mobile `HomeScreen.js` gains Party / Date / Time chips beside G5a's Nearby chip, each opening a picker modal (party stepper 1–30, month calendar grid with past-day gray-out, 15-min time slots 08:00–23:45); an all-or-none hint highlights the unset chips until all three are set, after which the GET fires and a result-count badge + a localized empty state render. 14 new `homeFilters.*` i18n keys (RO + EN).
- New smoke: `server/.smoke/g5b-restaurants-filter-test.js` (32/32 — unfiltered baseline, all-or-none partial sets, the four structured 400 codes, single-table / 2+2-merge / fully-booked / outside-service-period / disabled-date / closed cases, merge-insufficient at party 5, composition with `cuisine` + `lat`/`lng`).

**Resolved by Tier G commit 4 (2026-05-20):**
- ~~§6.3 service-period filter on Live.~~ New shared component `apps/restaurant/components/ServicePeriodFilter.jsx` — a `<select>` of the restaurant's service periods with an "All periods" default. Mounted on the Live floor plan (`app/dashboard/live/page.js`) in its own card above the Section tabs. Client-side filter: with a period selected, a table's guest overlay only renders when its reservation `time` falls inside the period's `[startTime, endTime)` window (helper `timeInPeriod`, handles cross-midnight); the table card itself still renders (status-only when filtered out). **Correction:** the Tier G kickoff audit claimed the Calendar page already had this filter inline and framed G4 as a "pure refactor" — that was wrong. Neither Calendar nor Live had a service-period filter (`calendar/page.js` has Date + Section selects only). The component was built fresh and mounted on Live. The Calendar's own §6.4 service-period filter remains open — see the §6.4 entry below.
- ~~§5.2 Google Maps embed on the mobile restaurant profile.~~ `react-native-maps@1.20.1` installed via `expo install` (SDK 54 compatible). `apps/mobile/src/screens/RestaurantDetailScreen.js` renders a read-only `<MapView>` (height 200, ~14–15 zoom) with a single `<Marker>` at the restaurant's lat/lng, in a rounded card directly below the address. Uses the platform-default map provider (Apple Maps iOS / Google Maps Android) rather than forcing `PROVIDER_GOOGLE` — the latter needs a Google Maps API key on iOS, which would break the Expo Go preview. The map section is omitted entirely when lat/lng are null (legacy rows). `Restaurant.latitude`/`longitude` arrive as Prisma `Decimal` → JSON strings, so they're `parseFloat`-coerced + finiteness-guarded.
- **Bundled fix:** added `apps/mobile/metro.config.js`. The Expo app had no Metro config, so Metro could not resolve `src/lib/colors.js`'s relative import into `<repo>/packages/shared` (outside the app dir) — every mobile bundle failed with `Unable to resolve module ../../../../packages/shared/theme/colors`. This was a pre-existing breakage (no G4 code involved); a standard Expo-monorepo config (`watchFolders` = repo root, dual `nodeModulesPaths`) fixes it. The Android JS bundle now builds clean (HTTP 200, ~7.3 MB, `react-native-maps` resolved).

**Resolved before Tier G (housekeeping closeout, 2026-05-20 — Tier G commit 1):**
The Tier G kickoff audit found the §15 backlog had drifted out of sync with the code. The following entries were already shipped by prior tiers; closed out here for clarity. Code locations cited so a future audit can re-verify.
- ~~§9.3 auto-confirm uses `gte`, not exact seat-match.~~ Already fixed at `server/src/routes/reservation.routes.js:150` (`seatCount: pSize`, inline code comment cites §9.3). Falls through to manual confirm when no exact match exists, as the spec requires.
- ~~§3.4 OTP routes still mounted.~~ `/send-otp` + `/verify-otp` already removed (delete-marker comment at `auth.routes.js:111-113`). The orphan OTP-send stub in `/login`'s phone-branch (lines 133-142 pre-G1) was removed in Tier G commit 1; phone login is no longer a path (email + password only, per §3.4).
- ~~§7.4 admin analytics still mounted.~~ Already removed (delete-marker at `admin.routes.js:1084-1086`). No frontend, no callers.
- ~~§7.5 admin billing still mounted.~~ Backend already removed (delete-marker at `admin.routes.js:1088-1092`); no frontend; no callers. `BillingReport` schema model intentionally retained per Tier C2 (non-destructive change; staying-power for a post-MVP billing rebuild).
- ~~Waitlist server routes still mounted.~~ All routes already removed (delete-marker at `restaurantPlatform.routes.js:2422`); no `Waitlist*` schema models exist. Orphan `WAITLIST_STATUS` / `WAITLIST_CONFIRM_WINDOW_MIN` / `WAITLIST_SECOND_REMINDER_MIN` exports in `packages/shared/src/constants/index.js` removed in Tier G commit 1; the stale `'waitlist_available'` doc-string example in the `Notification.type` comment (`schema.prisma:485`) updated to `'modification_requested'`. A2 `from_waitlist` column on `reservations` — **dropped in Tier G commit 7 (2026-05-20); see the Resolved-by-Tier-G-commit-7 entry below.**
- ~~§8.1 "Arriving Soon" auto-transition cron.~~ Already implemented at `server/src/socket/handlers.js:133-155` (60-second tick; flips FREE → ARRIVING_SOON one hour before each upcoming reservation).
- ~~§8.1 Awaiting Guest auto-transition + 15-min recurring reminder.~~ Already implemented at `server/src/socket/handlers.js:157-180` (auto-transition) + `:207-230` (15-min reminder, dedup via `dispatchedTimerAwaiting` Set, fires `TABLE_AWAITING_15_REMINDER`).
- ~~§8.1 120-min Occupied timer + expiry alert.~~ Already implemented at `server/src/socket/handlers.js:182-205` (dedup via `dispatchedTimer120`, fires `TABLE_TIMER_120_EXPIRED`).
- ~~§9.1 `specialRequests` column.~~ Already present at `server/prisma/schema.prisma:302` (`specialRequests String?  @map("special_requests") @db.Text`). Staff edit surface shipped in C6 P3-6; inline ✦ badge across all reservation surfaces shipped in C6 P3-9.

**Still open after Tier G commit 5a audit (2026-05-20):**
<!-- Calendar walk-ins / occupation state — resolved by Tier H commit 4 (2026-05-20). Past dates now render read-only walk-in segments from TableActivity; "current-occupation state" is by the locked v1.1 scope the Live floor plan's domain (Calendar redirects today→Live). The §6.4 service-period filter sub-item was resolved by Tier H commit 2. OOS-history rendering on past dates is the one remaining piece — logged under "Polish (deferred)" below. See Resolved-by-Tier-H-commit-4 above. -->
<!-- §5.1 multi-filter on mobile home — fully resolved. Cuisine + search were always exposed; the Location filter shipped in Tier G commit 5a (expo-location GPS → lat/lng → Haversine sort); party-size/date/time filters + the GET /restaurants query-param extension shipped in Tier G commit 5b (all-or-none availability join). See Resolved-by-Tier-G-commit-5a and Resolved-by-Tier-G-commit-5b above. -->
<!-- §5.6 modification request UI missing on mobile — resolved by Tier E commit 2 (2026-05-16). New ReservationDetailScreen + RequestChangeScreen mounted under AppStack; ReservationsScreen cards tap → detail and surface an inline amber Keep/Cancel banner on rejected modifications. New POST /reservations/:id/modifications/:modId/ack endpoint with action='keep'|'cancel'; the cancel path mirrors PUT /reservations/:id/cancel (status=CANCELLED, cancelledBy='user', RESERVATION_CANCELLED_BY_DINER + reservation:cancelled emits) inside a $transaction with the acknowledgement stamp. Three new modify validations (date-in-past, date-not-available, time-outside-hours) close the gap between POST /modify and POST /reservations. See Resolved-by-Tier-E-commit-2 above. -->
- **§6.2 dashboard gaps — partially resolved by Tier C6 P3-7 (2026-05-16).** Dashboard rebuilt as the waiter command center per `memory/waiter_ux_strategy.md` §3.8: three-zone layout (NOW / NEXT / SEARCH) with stat tiles and a header clock; dashboard-level guest search now in place (debounced 300ms call to `/api/restaurant/reservations/search`); "Add Reservation" entry point is the global floating + button (P3-1) which is visible on the dashboard (and every other dashboard page) per §3.2. **Still deferred to Tier J / future:** notification feed (separate from real-time toast — toast covers the urgent path via P3-2), ban-client search on dashboard (low-frequency operation per §3.8 out-of-scope list).
<!-- §6.3 service-period filter on Live — resolved by Tier G commit 4 (2026-05-20). New shared ServicePeriodFilter component mounted on the Live page; client-side overlay filter. See Resolved-by-Tier-G-commit-4 above. -->
<!-- §6.4 calendar interactions: click-block popup + tap-empty-slot resolved by C6 P3-8 — see Resolved section above. Edit-seats affordance + confirm-from-calendar remain deferred (admin scope + larger UX). -->
<!-- §6.5 modification request UI missing on restaurant — resolved by Tier E commit 1 (2026-05-16). ReservationDetailPopup renders amber "Requested changes:" callout + Approve change / Reject change buttons; new Modifications tab on the Reservations page with side-loaded count badge; backend POST /modify hardened (reservation-not-modifiable, modification-already-pending, no-op-modification); approve wrapped in $transaction. Diner-side request UI still pending in §5.6 above (Tier E commit 2). See Resolved-by-Tier-E-commit-1. -->
- **Confused Flow (b) instruction in past Cowork session.** "Diner books" should be tested via the mobile app, not via the staff create form. Spec is unchanged; just a testing/communication note.

### Missing features (IN scope, never built)
<!-- §5.9 Account deletion (GDPR) — resolved by Tier D commit 2 (2026-05-16). DELETE /api/users/me soft-deletes the User row (sets deletedAt; auth middleware rejects outstanding JWTs) and anonymizes PII on all of the user's reservation rows in a single transaction. Mobile ProfileScreen "Danger zone" + confirmation modal. See Resolved-by-Tier-D-commit-2 above. -->
<!-- §3.3 Diner forgot-password — resolved by Tier D commit 2 (2026-05-16). See Resolved-by-Tier-D-commit-2 above. -->
<!-- §3.1 post-first-reservation phone-collection prompt — resolved by Tier D commit 2 (2026-05-16). Inline soft prompt on BookReservationScreen step 4; dismissal persists via User.phonePromptSeenAt. -->

<!-- §5.3 Special requests UI — FULLY resolved. Schema column added in Tier B; staff edit surface (`PUT /reservations/:id` body field + edit-mode field in popup) shipped in C6 P3-6; inline ✦ badge across all reservation surfaces shipped in C6 P3-9; the diner-side mobile input + POST body field shipped in Tier J commit 1a (2026-05-20) — see Resolved-by-Tier-J-commit-1a above. -->
<!-- §6.8 Forgot password flow for restaurant staff — resolved by Tier D commit 1 (2026-05-16). POST /api/auth/restaurant/forgot-password issues a single-use, 1-hour-TTL token and emails the reset link via the C2 Resend transport to RestaurantStaff.email (fallback Restaurant.email). POST /api/auth/restaurant/reset-password validates the token and updates the password hash. New schema additions: RestaurantStaff.email (nullable text), PasswordResetToken model with userType field (polymorphic — diner reset reuses the same table in commit 2). Frontend pages: /forgot-password, /reset-password; /login has a "Forgot password?" link. End-to-end smoke verified: forgot-password → 200 neutral message + token persisted; reset valid → 200; reset expired → 400 token-expired; reset used → 400 token-used; login with new password → 200. -->
<!-- §6.4 Calendar enhancements — resolved by Tier H commit 4 (2026-05-20) under the locked v1.1 Calendar scope: past dates render walk-in segments + past activity (reservations at final statuses); today→Live redirect makes "current-occupation / live segment" the Live floor plan's job, not the Calendar's. OOS-history rendering on past dates is the sole deferred remainder — see "Polish (deferred)" below. See Resolved-by-Tier-H-commit-4 above. -->
<!-- §7.1 Photo uploads + Menu PDF upload — resolved by Tier F commit 1 (2026-05-16). Multer + Railway volume (server/uploads in dev). 5 admin endpoints + static /uploads serve + admin UI + mobile diner gallery/menu. See Resolved-by-Tier-F-commit-1 above. -->
<!-- §7.1 Reservation-disabled days — resolved by Tier F commit 2 (2026-05-16). 3 admin endpoints + 1 diner GET + mobile date picker gray-out. See Resolved-by-Tier-F-commit-2 above. -->
<!-- §7.2 Custom grid dimensions + section deletion + grid resize — resolved by Tier F commit 2 (2026-05-16). Existing PUT/DELETE /sections/:id endpoints hardened with shrink-orphans-tables + section-has-reservations 409 contracts; admin UI gains Edit grid + Delete section per-section modals. See Resolved-by-Tier-F-commit-2 above. -->
<!-- §8.1 "Arriving Soon" auto-transition cron — already implemented at server/src/socket/handlers.js:133-155. Closed out by Tier G commit 1 audit. -->
<!-- §8.1 Awaiting Guest auto-transition + 15-min recurring reminder — already implemented at server/src/socket/handlers.js:157-180 + 207-230. Closed out by Tier G commit 1 audit. -->
<!-- §8.1 120-min Occupied timer + expiry alert — already implemented at server/src/socket/handlers.js:182-205. Closed out by Tier G commit 1 audit. -->
<!-- §8.2 Table moving / combining — RESOLVED by Tier I (I1 backend data model + endpoints, I2 Live overlay drag UX + override modal, I3 calendar propagation + availability hint promotion + lifecycle auto-deactivate). See Resolved-by-Tier-I-commit-3 above. -->
<!-- §9.1 `specialRequests` column — already present at server/prisma/schema.prisma:302. Closed out by Tier G commit 1 audit. -->
<!-- Socket.IO real-time wiring resolved by Tier C4; i18n plumbing scaffold resolved by Tier C5; C6 Phase 1 data contracts and Phase 2 shared infrastructure (ToastProvider, ActionButton, ReservationDetailPopup, QuickAddReservation) resolved 2026-05-16 — see Resolved section above. Phase 3 wires components into pages. -->

<!-- i18n plumbing scaffold landed in Tier C5; full string coverage is incremental from C6. -->
<!-- §7.6 Auto-confirm toggle UI in restaurant Manage Profile — resolved by Tier G commit 3 (2026-05-20). The toggle + a minimal PUT /api/restaurant/settings already existed; G3 expanded that endpoint to the full §6.7 whitelist. See Resolved-by-Tier-G-commit-3 above. -->

### Polish (deferred)
- All visual/UX polish work happens after the above items ship and flows are correct.
<!-- Tailwind palette tints in status badges — resolved by Tier H commit 3 (2026-05-20). bg-X-100/text-X-NNN status-badge pairs centralized into status-*-bg/-fg tokens in packages/shared/theme/colors.js. See Resolved-by-Tier-H-commit-3 above. -->
<!-- Inline button colors — resolved by Tier H commit 3 (2026-05-20). Seat/Reject/Complete/etc. solid-button colors centralized into action-* tokens; feedback banners into alert-* tokens. See Resolved-by-Tier-H-commit-3 above. -->
<!-- bg-sidebar — resolved: `sidebar` is already the canonical token (tidied Tier H commit 1); no behavior change was needed. -->
- **Calendar OOS-history rendering (v1.1 gap, logged Tier H commit 4).** Past-date OOS periods are not drawn on the Calendar — `TableActivity` is not written for `OUT_OF_SERVICE` (only `WALK_IN`), so there is no historical OOS record to render. OOS remains a real-time-only signal on `RestaurantTable.status`. Shipping this needs a `TableActivity` write path for OOS transitions plus the Calendar segment rendering — deferred past MVP.
- **SMS transport (v1.1 gap, formalized Tier J commit 1c).** `channels/sms.js` is a stub — it logs + records `Notification` rows for audit but does not deliver via Twilio. Deferred to v1.1 by the §14 Decisions-log entry "2026-05-20: SMS transport deferred to v1.1"; push (live since Tier J commit 1b) covers the active-user §10 path. v1.1: stand up Twilio (account + credentials + cost) and replace the stub send.

---
