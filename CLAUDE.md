# ApRez — Project Guide for AI Assistants

> Read this file at the start of every Claude Code (or Cowork) session before touching code.
> The owner is **Sebastian Stroe** (Babson College, non-technical). Explain what you're doing and give terminal commands he can paste.

> **Source-of-truth precedence (revised 2026-04-30):** `SPEC.md` is the **single canonical product spec**. It supersedes both `ApRez FULL DOC MVP1.docx` and the now-archived `MVP_SCOPE.md`. Read `SPEC.md` before planning any feature; cross-reference its section numbers (§5.1, §6.5, §9.3, etc.) when discussing changes. The docx is kept in the repo for reference only — do **not** treat it as authoritative.

---

## What ApRez is

A restaurant reservation platform for Romania (think OpenTable). Two-sided marketplace:
- **Diners** discover restaurants and book via a mobile app
- **Restaurants** manage reservations and tables via a web platform
- **The ApRez team** onboards restaurants via an internal admin tool

Revenue: 1 RON per person per booking, billed monthly to restaurants. Sebastian handles billing manually for MVP.

The full product spec lives in `SPEC.md`. Always treat that as the source of truth for behavior. If `SPEC.md` and the code disagree, the code is wrong unless `SPEC.md`'s decisions log records an explicit override. If `SPEC.md` is silent on something, ask before assuming.

---

## Repo layout (npm workspaces monorepo)

```
aprez/
├── server/                  Node + Express + Prisma + Socket.IO + PostgreSQL (port 4000)
│   ├── src/
│   │   ├── index.js         Entry point
│   │   ├── routes/          API routes (auth, user, restaurant, reservation, waitlist, favorite, admin, restaurantPlatform)
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── socket/          Socket.IO handlers
│   │   └── jobs/            Scheduled jobs (45-min reminder, etc.)
│   └── prisma/
│       ├── schema.prisma    Source of truth for the data model
│       └── seed.js          Demo data seeder
├── apps/
│   ├── mobile/              Expo React Native — diner app (iOS + Android)
│   ├── restaurant/          Next.js 14 — restaurant staff dashboard (port 3001)
│   └── admin/               Next.js 14 — internal ApRez team tool (port 3002)
├── packages/
│   └── shared/              Shared constants (status labels, cuisine types, etc.)
└── package.json             Root workspace config
```

Database is hosted on **Railway** (Postgres). Connection string is in `server/.env`. No local Postgres needed.

---

## Demo credentials (after seed)

| Role | Email/Username | Password |
|---|---|---|
| Admin | admin@aprez.ro | admin123 |
| Restaurant staff | lamama | lamama123 |
| Diner | demo@aprez.ro | user123 |

---

## How to run everything (4 terminals)

```bash
# Terminal 1 — Backend
cd server && npm run dev
# → http://localhost:4000/api/health

# Terminal 2 — Restaurant platform
cd apps/restaurant && npm run dev
# → http://localhost:3001

# Terminal 3 — Admin tool
cd apps/admin && npm run dev
# → http://localhost:3002

# Terminal 4 — Mobile app (Expo)
cd apps/mobile && npm start
# Scan QR with Expo Go on phone, or press 'w' for web
```

Database commands (run from `server/`):
- `npm run db:generate` — regenerate Prisma client after schema changes
- `npm run db:push` — push schema to Railway DB (no migration files)
- `npm run db:seed` — repopulate demo data
- `npm run db:studio` — open Prisma Studio GUI

---

## Current status (snapshot — update this when things change)

**Built and working:**
- Auth (email + password); user/restaurant/admin login endpoints
- Mobile: Login, Home (restaurant list with filters + GPS distance), Restaurant Detail, Book Reservation (3-step flow)
- Backend: full reservation logic, auto-confirm rules, opening hours, time slot generation
- Admin backend: full CRUD for restaurants, tables, sections, staff, billing reports, audit logs

**Half-wired (top fixes before adding features — see SPEC.md §15):**
1. **Socket.IO has no frontend clients at all.** Backend emits, but `socket.io-client` is not imported in mobile, restaurant, OR admin. Real-time table status / reservation feed all rely on manual refresh.
2. **No i18n layer in any frontend.** Every UI string is hardcoded English, despite SPEC.md §11 + DoD #10 calling for Romanian-primary i18n. DB schema supports it (`nameRo`/`nameEn`, `User.preferredLanguage`); code doesn't.
3. **Auth is email+password only and incomplete.** No forgot-password reset flow (SPEC.md §6.8 / §3.3). No account-deletion (GDPR) endpoint (SPEC.md §5.9). Restaurant credentials are created by admin but never emailed — manual handoff for MVP is fine, flag for post-MVP.
4. **Push notifications not wired.** No Firebase setup, no FCM tokens stored, no 45-min reminder job (it's a TODO comment in `server/src/socket/handlers.js:92`). See SPEC.md §10.

**Design tokens unified:** `packages/shared/theme/colors.js` is the source of truth. Both Next apps consume `tailwindColors` from it. Mobile re-exports `Colors` from it.

**Floor plan endpoints DO exist** — earlier docs claimed otherwise. `PUT /api/restaurant/tables/:id/status` and `/seat` are at `server/src/routes/restaurantPlatform.routes.js`, and `apps/restaurant/app/dashboard/live/page.js` calls them correctly.

**Not built yet (and IN scope per SPEC.md §15):** account deletion (GDPR §5.9), forgot-password reset for staff (§6.8), "Special requests" free-text field on reservation (§5.3), modification approval/rejection flow (§5.6 — all modifications require staff approval), photos/menu PDF upload in admin (§7.1), reservation-disabled days (§7.1), custom grid dimensions per section (§7.2), table moving / combining (§8.2), Awaiting Guest auto-transition + 15-min reminder (§8.1), 120-min Occupied timer (§8.1), `specialRequests` schema column (§9.1), auto-confirm toggle on staff Manage Profile page (§6.7), favorites screen polish.

**Cut from MVP** (see SPEC.md §14 decisions log): waitlist (entire system, mobile + restaurant page + schema), Google Maps reviews, admin Analytics, admin Billing Support, WhatsApp/SMS OTP, diacritic-insensitive search, variable reservation duration, auto-ban on no-shows, phone international support beyond +40.

---

## Design system (single source of truth)

**Colors** live in `apps/mobile/src/lib/colors.js`. Web apps must read the same values via Tailwind's theme extension. When asked to "use the brand color" or "make it match", reference that file.

Brand: `primary` `#22c55e` (green). Secondary palette in the same file.

**Typography:** Inter for web, system font for mobile. Headings `font-semibold`, body `font-normal`. No more than 3 sizes per screen.

**Spacing:** Tailwind 4-point scale. Stick to `2/3/4/6/8/12/16` — don't invent.

**Radii:** `rounded-md` (6px) for inputs/buttons, `rounded-xl` (12px) for cards, `rounded-full` for pills/avatars.

**Components:** Build a small set in `apps/<app>/components/ui/` and reuse them. Buttons, inputs, cards, modals, badges, empty-states. Don't repaint each page.

---

## Definition of Done (every feature must hit this before we call it shipped)

A feature is not done unless **every** box is checked:

1. **Backend route exists, returns the right shape, and is tested via curl or REST client.**
2. **Frontend calls the real endpoint** (no `// TODO: replace with real API` comments).
3. **Loading state + error state + empty state are all handled in the UI.** Not just the happy path.
4. **Form inputs have validation** (party size 1–30, future dates only, required fields, etc.).
5. **Auth gate respected** — restaurant staff can only see their own restaurant; admins can see everything; diners can't hit admin endpoints.
6. **The flow round-trips end-to-end** — e.g. user creates a reservation, restaurant sees it appear in their dashboard within a refresh, the user gets a "confirmed" or "pending" status that matches what was decided server-side.
7. **Uses the design system** — no inline hex colors, no one-off Tailwind colors that don't match the palette.
8. **No console errors** in browser/Metro when navigating the flow.
9. **Spec match** — behavior matches `ApRez FULL DOC MVP1.docx`. If there's a conflict, surface it; don't silently change either.
10. **Bilingual** — UI strings go through the i18n layer (Romanian primary, English secondary). No hardcoded English in UI.

For Claude Code: when implementing a feature, write the DoD checklist as comments at the top of the PR/commit message and tick them off.

---

## Working style for AI assistants

- **Don't trust yourself on the spec.** Re-read the relevant section of `SPEC.md` (cite section numbers like §5.3, §6.5) before implementing a flow.
- **Manual visual verification is required.** API smoke-tests are necessary but not sufficient. For any UI change, open the affected page in a real browser, walk the flow, and confirm. See DoD #6 and #12 in `SPEC.md`.
- **Refuse to ship half-wired flows.** If a UI button calls an endpoint that doesn't exist yet, build the endpoint first or stop and flag it. Don't paper over with mocks.
- **Small commits.** One feature or fix per commit. Conventional commits format: `feat:`, `fix:`, `chore:`, `refactor:`.
- **Ask before destructive changes.** Schema migrations, deleting files, changing auth flow — confirm with Sebastian.
- **Romania-aware.** All times in Europe/Bucharest TZ. Phone format `+40...`. Currency RON. Default language Romanian.

---

## Where to find the work backlog

The authoritative list of remaining MVP work lives in `SPEC.md` §15 "Known gaps & bugs to fix". Each entry references a section of `SPEC.md` so the spec context is one click away.

When starting a new feature, read its `SPEC.md` section in full (not just the summary), build the feature, and remove the entry from §15 only after the feature passes manual visual verification (DoD #12).
