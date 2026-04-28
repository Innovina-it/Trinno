# Trello Clone

Foundation slice. Auth + RLS-backed workspaces. UI for boards/lists/cards ships in subsequent plans.

Stack: Next.js 15 (App Router) + Supabase (Postgres / Auth / Mailpit) + Drizzle ORM + Tailwind v4 + shadcn/ui. Vitest for unit + integration, Playwright for E2E.

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

Open http://localhost:3000, you will be redirected to `/login`. Sign up at `/signup`, then click the confirmation link in Mailpit at http://127.0.0.1:54324.

## Tests

```bash
npm run test:unit   # vitest (needs supabase running)
npm run test:e2e    # playwright (auto-starts dev server via webServer)
```

## Reset DB

```bash
npm run db:reset    # re-applies all migrations from scratch
```

## Layout

```
app/(auth)/        login, signup, /auth/callback
app/(app)/         protected shell + workspace home
actions/           server actions (logout)
lib/auth.ts        getUser / requireUser helpers
lib/db/            drizzle schema + dbAsUser (per-request RLS)
lib/supabase/      server / browser / middleware clients
supabase/migrations/  SQL migrations (schema, trigger, RLS)
tests/integration/    vitest (DB-backed)
tests/e2e/            playwright
```
