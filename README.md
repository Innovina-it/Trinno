# Trinno

Internal team workspace. Boards, roadmap, sprints, dashboards. Auth, workspaces, lists, cards, drag-drop, real-time multi-user sync, presence, labels, due dates, comments, attachments, activity log, search.

Stack: Next.js 15 (App Router, Server Actions) + Supabase (Postgres / Auth / Realtime / Storage / Mailpit) + Drizzle ORM with per-request RLS via `dbAsUser` + Tailwind v4 + shadcn/ui (base-ui) + dnd-kit + fractional-indexing + Zustand. Vitest for unit + integration, Playwright for E2E.

## Project status

See **[PROJECT-MAP.md](PROJECT-MAP.md)** for the current subsystem map (state, gaps, upgrade backlog per section).

Shipped, roughly in order:

- **Foundation (Plans 1–7):** auth + `dbAsUser` per-request RLS, workspaces/boards/members, kanban core (lists, cards, dnd-kit, fractional positions), realtime + presence, card features (labels, members, checklists, due dates, comments, attachments), activity log + full-text search, CI matrix.
- **Planning layer:** roadmap/Gantt (4 view modes, lanes, zoom), sprints + backlog + sprint reports, milestones, versions, components, baselines with variance analysis + Approved flag, critical path, dependency arrows.
- **Reporting:** dashboards with gadgets, workload allocation view, aggregate kanban (My tasks), `/me` personal surfaces, worklogs.
- **Notifications:** in-app inbox, email (Resend, per-event + daily digest crons), Telegram channel (link handshake, /stop), watchers, SLA policies + breach scan, tiered per-event prefs.
- **Membership:** invitation flow with reminders + domain carve-out, guest role, onboarding spotlight tour, demo seeding.
- **PMA (Project Management Assistant):** Google Drive change detection → Gemini analysis → native Google Doc reports vs approved baselines, run history UI (U1–U12).
- **Misc:** links with brand-color palette, card relations, favorites, holidays calendar (IT presets), sub-boards (flag-gated), card field/sprint history, archive view, board templates.

Current state of the data layer: 43 tables, 133 migrations, RLS on 35 tables, 170 test files.

## Prereqs

- Node 20+
- Docker (for the Supabase local stack)
- Supabase CLI (`brew install supabase/tap/supabase`, or download from https://github.com/supabase/cli/releases)

## Quickstart

```bash
supabase start
{
  supabase status -o env | sed -E \
    -e 's/^API_URL=/NEXT_PUBLIC_SUPABASE_URL=/' \
    -e 's/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_ANON_KEY=/' \
    -e 's/^SERVICE_ROLE_KEY=/SUPABASE_SERVICE_ROLE_KEY=/' \
    -e 's/^DB_URL=/DATABASE_URL=/'
} > .env.local
npm install
npm run dev   # http://localhost:3000
```

Open http://localhost:3000 (redirects to `/login`). Sign up at `/signup`, click the confirmation link in Mailpit at http://127.0.0.1:54324, land on a workspace.

## Tests

```bash
npm run test:unit   # vitest (needs supabase running)
npm run test:e2e    # playwright (auto-starts dev server via webServer)
npm run type-check  # tsc --noEmit
npm run lint        # eslint
```

40+ integration tests, 6 E2E specs.

## CI

GitHub Actions workflow at `.github/workflows/ci.yml` runs three jobs on every PR + push to `main`:

1. **lint** — `npm run lint && npx tsc --noEmit`.
2. **integration** — boots Supabase via `supabase/setup-cli`, runs vitest.
3. **e2e** — boots Supabase + Playwright (cached browsers), runs e2e suite, uploads HTML report on failure.

## Reset DB

```bash
npm run db:reset    # re-applies all migrations from scratch
```

If you see auth 502s right after a reset, restart Kong: `docker restart supabase_kong_trello-foundation`.

## Layout

```
app/(auth)/        login, signup, /auth/callback
app/(app)/         protected shell + workspace home + board view
app/api/upload/    signed-URL upload for attachments
actions/           server actions (auth, workspaces, boards, lists, cards,
                   workspace-members, labels, card-members, checklists,
                   comments, attachments, search)
lib/auth.ts        getUser / requireUser / getSessionToken
lib/db/            drizzle schema + dbAsUser (per-request RLS)
lib/queries/       SSR read helpers (board snapshot, activity, search, …)
lib/supabase/      server / browser / middleware clients
hooks/             use-board-realtime, use-board-presence
stores/            zustand board store (per-board provider)
components/board/  board view, columns, cards, modal, sections
components/nav/    top nav, workspace switcher, search box
supabase/migrations/  SQL migrations (schema, RLS, triggers, realtime publication)
tests/integration/    vitest (DB-backed)
tests/e2e/            playwright
docs/superpowers/     design spec + 7 implementation plans
```
