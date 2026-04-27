# ApRez — Project Guide for AI Assistants

> Read this file at the start of every Claude Code (or Cowork) session before touching code.
> The owner is **Sebastian Stroe** (Babson College, non-technical). Explain what you're doing and give terminal commands he can paste.

---

## What ApRez is

A restaurant reservation platform for Romania (think OpenTable). Two-sided marketplace:
- **Diners** discover restaurants and book via a mobile app
- **Restaurants** manage reservations and tables via a web platform
- **The ApRez team** onboards restaurants via an internal admin tool

Revenue: 1 RON per person per booking, billed monthly to restaurants. Sebastian handles billing manually for MVP.

The full product spec lives in `ApRez FULL DOC MVP1.docx` (uploaded). Always treat that as the source of truth for behavior. If the spec and code disagree, ask before changing the spec.

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

**Half-wired (top fixes before adding features):**
1. **Restaurant Live floor plan calls endpoints that don't exist** (`PUT /api/restaurant/tables/{id}/status` and `/seat`). UI is built, backend isn't. Fix in `server/src/routes/restaurantPlatform.routes.js`.
2. **Phone OTP is stubbed** — logs to console instead of sending SMS. Twilio integration pending.
3. **Socket.IO declared but no frontend listens.** Real-time table status, reservation feed, etc. not wired.
4. **No design tokens for web apps.** Mobile has `apps/mobile/src/lib/colors.js`. Restaurant + admin apps use raw Tailwind classes. Unify before adding more pages.
5. **Restaurant credentials never delivered** — admin creates staff, but no email is sent. Manual handoff for now is fine, but flag this.

**Not built yet:** waitlist UI, favorites screen polish, push notifications (Firebase), 45-min reminder job, banned users list UI, modification rejection flow.

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

- **Don't trust yourself on the spec.** Re-read the relevant section of `ApRez FULL DOC MVP1.docx` before implementing a flow.
- **Refuse to ship half-wired flows.** If a UI button calls an endpoint that doesn't exist yet, build the endpoint first or stop and flag it. Don't paper over with mocks.
- **Small commits.** One feature or fix per commit. Conventional commits format: `feat:`, `fix:`, `chore:`, `refactor:`.
- **Ask before destructive changes.** Schema migrations, deleting files, changing auth flow — confirm with Sebastian.
- **Romania-aware.** All times in Europe/Bucharest TZ. Phone format `+40...`. Currency RON. Default language Romanian.

---

## Tech debt to address before MVP launch (in order)

1. Unify the design system across web + mobile (point to `packages/shared/theme`).
2. Implement missing restaurant table status endpoints.
3. Wire Socket.IO end-to-end for live updates (table status, new reservations).
4. Twilio SMS for phone OTP.
5. Firebase push notifications + 45-min reminder job.
6. Bilingual i18n layer (Romanian/English) plumbed through all three frontends.
7. Production deploy plan (Vercel for web, Railway for backend, Expo EAS for mobile).
