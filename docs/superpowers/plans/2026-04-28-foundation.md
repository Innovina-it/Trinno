# Trello Clone — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js + Supabase + Drizzle foundation with working email/password auth, RLS-enforced foundation tables (profiles, workspaces, workspace_members, boards, board_members), and a protected app shell that lands signed-in users on a workspace home page.

**Architecture:** Next.js 15 App Router fullstack with Supabase as the only backend. Server Actions mutate via Drizzle running inside per-request transactions that set `request.jwt.claims` so RLS sees the calling user. supabase-js handles auth flows (signup/login/logout) and will later handle realtime subscriptions. Postgres triggers auto-create the user's profile and a default personal workspace on signup.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui, Supabase (Postgres + Auth), `@supabase/ssr`, Drizzle ORM with `postgres` driver, Vitest, Playwright.

**Out of scope for this plan (deferred):** Workspace/board CRUD UI (plan #2), lists/cards/drag-drop (plan #3), realtime (plan #4), card features (plan #5), activity/search (plan #6), GitHub Actions CI (plan #7).

**Definition of done:** A new visitor can sign up, confirm email via Inbucket, get auto-redirected to a workspace home page that shows their default workspace name and a logout button. Logout returns them to the login page. Non-authenticated visits to `/` redirect to `/login`. RLS prevents one user from reading another user's workspace via direct DB query.

---

## File Structure

**Config / scaffolding**
- `package.json` — npm scripts and deps
- `next.config.ts` — Next.js config
- `tsconfig.json` — strict TypeScript
- `tailwind.config.ts`, `postcss.config.mjs`, `app/globals.css` — Tailwind v4
- `components.json` — shadcn config
- `drizzle.config.ts` — Drizzle CLI config
- `vitest.config.ts` — unit + integration test runner
- `playwright.config.ts` — E2E
- `.env.local.example` — env template
- `.gitignore` — Node/Next/Supabase ignores
- `supabase/config.toml` — Supabase local stack (auto)

**Database**
- `supabase/migrations/0001_init.sql` — foundation tables + indexes
- `supabase/migrations/0002_profile_trigger.sql` — auth.users → profile + default workspace
- `supabase/migrations/0003_rls.sql` — RLS policies for foundation tables
- `lib/db/schema.ts` — Drizzle schema mirror of SQL
- `lib/db/client.ts` — Drizzle client + `dbAsUser` helper

**Supabase clients**
- `lib/supabase/server.ts` — Server Component / Server Action client (cookies)
- `lib/supabase/browser.ts` — client component client
- `lib/supabase/middleware.ts` — auth refresh in middleware
- `middleware.ts` — Next.js middleware entry point

**Auth**
- `lib/auth.ts` — `requireUser`, `getSession` helpers
- `actions/auth.ts` — logout Server Action
- `app/(auth)/login/page.tsx`
- `app/(auth)/signup/page.tsx`
- `app/(auth)/auth/callback/route.ts`
- `components/auth/login-form.tsx`
- `components/auth/signup-form.tsx`

**App shell**
- `app/layout.tsx` — root layout
- `app/(app)/layout.tsx` — auth gate + nav
- `app/(app)/page.tsx` — workspace home placeholder
- `components/nav/top-nav.tsx`
- `components/ui/*` — shadcn primitives (Button, Input, Label, Form, Toast)

**Tests**
- `tests/unit/auth.test.ts` — `requireUser` returns/redirects correctly
- `tests/integration/rls.test.ts` — non-member cannot read another user's workspace
- `tests/integration/profile-trigger.test.ts` — signup creates profile + default workspace
- `tests/e2e/auth.spec.ts` — signup → confirm → home → logout

---

## Task 1: Bootstrap Next.js project

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`

- [ ] **Step 1: Run create-next-app non-interactively**

```bash
cd /home/innovina/Documents/Trinnovina
npx --yes create-next-app@15 . --ts --tailwind --eslint --app --src-dir=false \
  --import-alias="@/*" --no-turbopack --use-npm
```

If the command refuses because the directory contains `docs/`, instead scaffold into `_scaffold/` then move files:

```bash
npx --yes create-next-app@15 _scaffold --ts --tailwind --eslint --app \
  --src-dir=false --import-alias="@/*" --no-turbopack --use-npm
shopt -s dotglob
mv _scaffold/* _scaffold/.* . 2>/dev/null || true
rmdir _scaffold
```

- [ ] **Step 2: Verify dev server boots**

```bash
npm run dev &
sleep 5
curl -fsS http://localhost:3000 | head -3
kill %1
```

Expected: HTML containing `<!DOCTYPE html>`. Non-zero exit means scaffold failed — investigate before continuing.

- [ ] **Step 3: Replace default page placeholder with "Hello"**

Replace `app/page.tsx` with:

```tsx
export default function Home() {
  return <main className="p-8">Hello</main>;
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Next.js 15 app"
```

---

## Task 2: Initialize Supabase local stack

**Files:**
- Create: `supabase/config.toml` (auto), updates to `.gitignore`

- [ ] **Step 1: Install Supabase CLI if missing**

```bash
command -v supabase || npm i -g supabase
supabase --version
```

Expected: prints version `1.x` or higher.

- [ ] **Step 2: Initialize project**

```bash
supabase init
```

Accept defaults. Creates `supabase/` directory.

- [ ] **Step 3: Start local stack (Postgres, Auth, Studio, Inbucket)**

```bash
supabase start
```

Expected: prints API URL, anon key, service_role key, DB URL, Inbucket URL. Stack is now running on Docker.

- [ ] **Step 4: Confirm Postgres is reachable**

```bash
supabase status | grep "DB URL"
```

Expected: `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`

- [ ] **Step 5: Add Supabase artifacts to .gitignore**

Append to `.gitignore`:

```
# Supabase local
supabase/.branches
supabase/.temp
.env.local
```

- [ ] **Step 6: Commit**

```bash
git add supabase .gitignore
git commit -m "chore: initialize supabase local stack"
```

---

## Task 3: Wire environment variables

**Files:**
- Create: `.env.local.example`, `.env.local`

- [ ] **Step 1: Capture local Supabase credentials**

```bash
supabase status -o env
```

Expected output (values vary):

```
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

- [ ] **Step 2: Write `.env.local.example`**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-me
SUPABASE_SERVICE_ROLE_KEY=replace-me
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

- [ ] **Step 3: Generate `.env.local` from running stack**

```bash
{ supabase status -o env; echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres"; } > .env.local
```

Verify:

```bash
grep -c "NEXT_PUBLIC_SUPABASE_URL" .env.local
```

Expected: `1`.

- [ ] **Step 4: Commit (example only — `.env.local` is gitignored)**

```bash
git add .env.local.example
git commit -m "chore: env template for supabase"
```

---

## Task 4: Install runtime dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime packages**

```bash
npm install @supabase/supabase-js @supabase/ssr drizzle-orm postgres zod
```

- [ ] **Step 2: Install dev tooling**

```bash
npm install -D drizzle-kit vitest @vitest/coverage-v8 @testing-library/react \
  @testing-library/jest-dom jsdom @playwright/test tsx dotenv
```

- [ ] **Step 3: Install Playwright browsers**

```bash
npx playwright install --with-deps chromium
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add supabase, drizzle, test tooling"
```

---

## Task 5: Configure Drizzle

**Files:**
- Create: `drizzle.config.ts`, `lib/db/schema.ts`

- [ ] **Step 1: Write `drizzle.config.ts`**

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./supabase/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 2: Stub schema file (real tables added in Task 6)**

```ts
// lib/db/schema.ts
export const _placeholder = true;
```

- [ ] **Step 3: Verify drizzle-kit reads config**

```bash
npx drizzle-kit --version
```

Expected: prints version, no error.

- [ ] **Step 4: Commit**

```bash
git add drizzle.config.ts lib/db/schema.ts
git commit -m "chore: drizzle config + schema stub"
```

---

## Task 6: Define foundation schema (TDD)

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `tests/integration/schema.test.ts`
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/integration/schema.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

describe("foundation schema", () => {
  it("has all foundation tables", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('profiles','workspaces','workspace_members',
                           'boards','board_members')
    `;
    expect(rows.map(r => r.table_name).sort()).toEqual([
      "board_members", "boards", "profiles",
      "workspace_members", "workspaces",
    ]);
  });
});
```

- [ ] **Step 2: Add minimal vitest config so the test can run**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [],
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
  },
});
```

- [ ] **Step 3: Run test, verify failure**

```bash
npx vitest run tests/integration/schema.test.ts
```

Expected: FAIL — none of the tables exist.

- [ ] **Step 4: Write the SQL migration**

```sql
-- supabase/migrations/0001_init.sql
create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create type public.workspace_role as enum ('owner','admin','member');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'member',
  primary key (workspace_id, user_id)
);

create index on public.workspace_members (user_id);

create type public.board_visibility as enum ('private','workspace');
create type public.board_role        as enum ('admin','member','observer');

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  background_kind text not null default 'color' check (background_kind in ('color','image')),
  background_value text not null default '#0079bf',
  visibility public.board_visibility not null default 'workspace',
  created_by uuid not null references public.profiles(id) on delete restrict,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create index on public.boards (workspace_id);

create table public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.board_role not null default 'member',
  primary key (board_id, user_id)
);

create index on public.board_members (user_id);
```

- [ ] **Step 5: Apply migration**

```bash
supabase db reset
```

Expected: prints `Finished supabase db reset on local database`.

- [ ] **Step 6: Mirror schema in Drizzle**

```ts
// lib/db/schema.ts
import {
  pgTable, uuid, text, timestamptz, boolean, primaryKey, pgEnum,
} from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", ["owner","admin","member"]);
export const boardRole     = pgEnum("board_role",     ["admin","member","observer"]);
export const boardVisibility = pgEnum("board_visibility", ["private","workspace"]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId:      uuid("user_id").notNull(),
    role:        workspaceRole("role").notNull().default("member"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.userId] }) })
);

export const boards = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  title: text("title").notNull(),
  backgroundKind:  text("background_kind").notNull().default("color"),
  backgroundValue: text("background_value").notNull().default("#0079bf"),
  visibility: boardVisibility("visibility").notNull().default("workspace"),
  createdBy: uuid("created_by").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const boardMembers = pgTable(
  "board_members",
  {
    boardId: uuid("board_id").notNull(),
    userId:  uuid("user_id").notNull(),
    role:    boardRole("role").notNull().default("member"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.boardId, t.userId] }) })
);
```

> Note: `timestamptz` import is from a helper not present by default — replace with `timestamp("...", { withTimezone: true })` if Drizzle complains. The verification is the test, not the import.

- [ ] **Step 7: Re-run test, verify pass**

```bash
npx vitest run tests/integration/schema.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0001_init.sql lib/db/schema.ts \
        tests/integration/schema.test.ts vitest.config.ts
git commit -m "feat(db): foundation tables (profiles, workspaces, boards)"
```

---

## Task 7: Profile + default workspace trigger (TDD)

**Files:**
- Create: `supabase/migrations/0002_profile_trigger.sql`, `tests/integration/profile-trigger.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
// tests/integration/profile-trigger.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const sql = postgres(process.env.DATABASE_URL!);

describe("profile trigger", () => {
  it("creates profile and default workspace on signup", async () => {
    const email = `t-${Date.now()}@example.com`;
    const { data, error } = await supa.auth.admin.createUser({
      email, password: "passw0rd!", email_confirm: true,
    });
    expect(error).toBeNull();
    const uid = data.user!.id;

    const profile = await sql`select display_name from profiles where id = ${uid}`;
    expect(profile[0].display_name).toBe(email.split("@")[0]);

    const ws = await sql`
      select w.name from workspaces w
      join workspace_members m on m.workspace_id = w.id
      where m.user_id = ${uid} and m.role = 'owner'`;
    expect(ws.length).toBe(1);
    expect(ws[0].name).toContain(email.split("@")[0]);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npx vitest run tests/integration/profile-trigger.test.ts
```

Expected: FAIL — no profile row created.

- [ ] **Step 3: Write the trigger migration**

```sql
-- supabase/migrations/0002_profile_trigger.sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_workspace_id uuid;
  local_part text := split_part(new.email, '@', 1);
begin
  insert into public.profiles (id, display_name)
  values (new.id, local_part);

  insert into public.workspaces (name, owner_id)
  values (local_part || '''s Workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 4: Apply and re-test**

```bash
supabase db reset
npx vitest run tests/integration/profile-trigger.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_profile_trigger.sql tests/integration/profile-trigger.test.ts
git commit -m "feat(db): auto-create profile + default workspace on signup"
```

---

## Task 8: RLS policies for foundation tables (TDD)

**Files:**
- Create: `supabase/migrations/0003_rls.sql`, `tests/integration/rls.test.ts`

- [ ] **Step 1: Write failing RLS test**

```ts
// tests/integration/rls.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(email: string) {
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("RLS on workspaces", () => {
  it("non-member cannot see another user's workspace", async () => {
    const a = await makeUser(`a-${Date.now()}@x.io`);
    const b = await makeUser(`b-${Date.now()}@x.io`);

    const aClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${a.jwt}` } },
      auth: { persistSession: false },
    });
    const bClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${b.jwt}` } },
      auth: { persistSession: false },
    });

    const { data: aOwn } = await aClient.from("workspaces").select("id,name");
    expect(aOwn?.length).toBe(1);

    const { data: bSeesA } = await bClient.from("workspaces").select("id,name");
    const aId = aOwn![0].id;
    expect(bSeesA?.find(w => w.id === aId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npx vitest run tests/integration/rls.test.ts
```

Expected: FAIL — without RLS, every user sees every workspace.

- [ ] **Step 3: Write RLS migration**

```sql
-- supabase/migrations/0003_rls.sql
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.boards            enable row level security;
alter table public.board_members     enable row level security;

-- profiles: anyone authenticated can read profiles of workspace co-members; users update own
create policy profiles_self_select on public.profiles for select
  using (auth.uid() = id or exists (
    select 1
    from public.workspace_members me
    join public.workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = auth.uid() and them.user_id = profiles.id
  ));

create policy profiles_self_update on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- workspaces: members read; owners/admins write
create policy workspaces_member_select on public.workspaces for select
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspaces.id and m.user_id = auth.uid()
  ));

create policy workspaces_owner_update on public.workspaces for update
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspaces.id
      and m.user_id = auth.uid() and m.role in ('owner','admin')
  ));

create policy workspaces_owner_delete on public.workspaces for delete
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspaces.id
      and m.user_id = auth.uid() and m.role = 'owner'
  ));

-- workspace_members: members read; owners/admins write
create policy ws_members_select on public.workspace_members for select
  using (exists (
    select 1 from public.workspace_members me
    where me.workspace_id = workspace_members.workspace_id
      and me.user_id = auth.uid()
  ));

create policy ws_members_admin_write on public.workspace_members for all
  using (exists (
    select 1 from public.workspace_members me
    where me.workspace_id = workspace_members.workspace_id
      and me.user_id = auth.uid() and me.role in ('owner','admin')
  ))
  with check (exists (
    select 1 from public.workspace_members me
    where me.workspace_id = workspace_members.workspace_id
      and me.user_id = auth.uid() and me.role in ('owner','admin')
  ));

-- boards: members read (or workspace member if visibility = 'workspace');
--         board admins or workspace owner/admin write
create policy boards_select on public.boards for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = boards.id and bm.user_id = auth.uid())
    or (
      boards.visibility = 'workspace' and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = boards.workspace_id and wm.user_id = auth.uid()
      )
    )
  );

create policy boards_admin_write on public.boards for all
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = boards.id and bm.user_id = auth.uid() and bm.role = 'admin')
    or exists (select 1 from public.workspace_members wm
               where wm.workspace_id = boards.workspace_id
                 and wm.user_id = auth.uid() and wm.role in ('owner','admin'))
  )
  with check (
    exists (select 1 from public.workspace_members wm
            where wm.workspace_id = boards.workspace_id
              and wm.user_id = auth.uid() and wm.role in ('owner','admin'))
  );

-- board_members: same gate as boards write
create policy board_members_select on public.board_members for select
  using (exists (
    select 1 from public.board_members me
    where me.board_id = board_members.board_id and me.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = board_members.board_id and wm.user_id = auth.uid()
  ));

create policy board_members_admin_write on public.board_members for all
  using (exists (
    select 1 from public.board_members me
    where me.board_id = board_members.board_id
      and me.user_id = auth.uid() and me.role = 'admin'
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = board_members.board_id
      and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ))
  with check (exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = board_members.board_id
      and wm.user_id = auth.uid() and wm.role in ('owner','admin')
  ));
```

- [ ] **Step 4: Apply and re-test**

```bash
supabase db reset
npx vitest run tests/integration/rls.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_rls.sql tests/integration/rls.test.ts
git commit -m "feat(db): RLS policies for foundation tables"
```

---

## Task 9: Supabase client trio

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `lib/supabase/middleware.ts`

- [ ] **Step 1: Server (Server Components / Actions)**

```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    }
  );
}
```

- [ ] **Step 2: Browser (Client Components)**

```ts
// lib/supabase/browser.ts
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Middleware (cookie refresh)**

```ts
// lib/supabase/middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supa = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );
  await supa.auth.getUser();
  return res;
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/supabase
git commit -m "feat: supabase client trio (server/browser/middleware)"
```

---

## Task 10: Drizzle client with per-request RLS

**Files:**
- Create: `lib/db/client.ts`, `tests/integration/db-as-user.test.ts`

- [ ] **Step 1: Write failing test for `dbAsUser`**

```ts
// tests/integration/db-as-user.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(email: string) {
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("dbAsUser", () => {
  it("queries through Drizzle respect RLS", async () => {
    const a = await makeUser(`d-${Date.now()}@x.io`);
    const rows = await dbAsUser(a.jwt, async (tx) =>
      tx.select().from(workspaces)
    );
    expect(rows.length).toBe(1);
    expect(rows[0].ownerId).toBe(a.id);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npx vitest run tests/integration/db-as-user.test.ts
```

Expected: FAIL — `lib/db/client.ts` does not exist.

- [ ] **Step 3: Implement client**

```ts
// lib/db/client.ts
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import * as schema from "./schema";

const queryClient = postgres(process.env.DATABASE_URL!, { max: 10, prepare: false });
export const db = drizzle(queryClient, { schema });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function dbAsUser<T>(
  jwt: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = decodeJwt(jwt);
    await tx.execute(dsql`set local role authenticated`);
    await tx.execute(dsql`set local request.jwt.claims = ${JSON.stringify(claims)}`);
    return fn(tx);
  });
}

function decodeJwt(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}
```

- [ ] **Step 4: Re-run test, verify pass**

```bash
npx vitest run tests/integration/db-as-user.test.ts
```

Expected: PASS — exactly 1 workspace, owned by user A.

- [ ] **Step 5: Commit**

```bash
git add lib/db/client.ts tests/integration/db-as-user.test.ts
git commit -m "feat(db): drizzle client with per-request RLS via dbAsUser"
```

---

## Task 11: Auth helpers (TDD)

**Files:**
- Create: `lib/auth.ts`, `tests/integration/auth.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/integration/auth.test.ts
import { describe, it, expect } from "vitest";
import { getSessionToken } from "@/lib/auth";

describe("getSessionToken", () => {
  it("returns null when no Supabase cookie present", async () => {
    // simulated empty environment via dynamic mock
    const { cookies } = await import("next/headers");
    // @ts-expect-error stub
    cookies.__set?.([]);
    const token = await getSessionToken();
    expect(token).toBeNull();
  });
});
```

> Note: this is a thin integration test. The real coverage is the E2E test in Task 17. The unit test exists to catch null-return regression.

- [ ] **Step 2: Implement helpers**

```ts
// lib/auth.ts
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function getSessionToken(): Promise<string | null> {
  const supa = await createSupabaseServer();
  const { data } = await supa.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getUser() {
  const supa = await createSupabaseServer();
  const { data } = await supa.auth.getUser();
  return data.user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSession() {
  const supa = await createSupabaseServer();
  const { data } = await supa.auth.getSession();
  if (!data.session) redirect("/login");
  return data.session;
}
```

- [ ] **Step 3: Run unit test**

```bash
npx vitest run tests/integration/auth.test.ts
```

Expected: PASS (token is null with no cookie).

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts tests/integration/auth.test.ts
git commit -m "feat(auth): getUser/requireUser/requireSession helpers"
```

---

## Task 12: Next.js middleware for auth refresh

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Write middleware**

```ts
// middleware.ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(req: NextRequest) {
  return updateSession(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 2: Smoke test**

```bash
npm run dev &
sleep 5
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill %1
```

Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: middleware to refresh supabase session cookies"
```

---

## Task 13: Install shadcn/ui primitives

**Files:**
- Create: `components.json`, `components/ui/button.tsx`, `components/ui/input.tsx`, `components/ui/label.tsx`, `components/ui/form.tsx`, `components/ui/sonner.tsx`, `lib/utils.ts`

- [ ] **Step 1: Init shadcn**

```bash
npx --yes shadcn@latest init -d
```

Accept defaults: TypeScript, default style, neutral base color, `app/globals.css`, CSS variables, `tailwind.config.ts`, alias `@/components` and `@/lib`.

- [ ] **Step 2: Add primitives**

```bash
npx --yes shadcn@latest add button input label form sonner
```

- [ ] **Step 3: Mount Toaster in root layout**

Replace `app/layout.tsx`:

```tsx
import "./globals.css";
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = { title: "Trello Clone" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components.json components/ui lib/utils.ts app/layout.tsx app/globals.css \
        tailwind.config.ts components.json
git commit -m "chore: shadcn init + base primitives"
```

---

## Task 14: Signup form + page

**Files:**
- Create: `app/(auth)/signup/page.tsx`, `components/auth/signup-form.tsx`

- [ ] **Step 1: Build the client form**

```tsx
// components/auth/signup-form.tsx
"use client";
import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    setSent(true);
  }

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Check your email for a confirmation link.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 w-full max-w-sm">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" required minLength={8}
               value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating account…" : "Sign up"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Build the page**

```tsx
// app/(auth)/signup/page.tsx
import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="space-y-6 w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <SignupForm />
        <p className="text-sm text-muted-foreground">
          Already have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Smoke test the page renders**

```bash
npm run dev &
sleep 5
curl -fsS http://localhost:3000/signup | grep -c "Create your account"
kill %1
```

Expected: `1`.

- [ ] **Step 4: Commit**

```bash
git add app/\(auth\) components/auth
git commit -m "feat(auth): signup form + page"
```

---

## Task 15: Login form + page

**Files:**
- Create: `app/(auth)/login/page.tsx`, `components/auth/login-form.tsx`

- [ ] **Step 1: Build the client form**

```tsx
// components/auth/login-form.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 w-full max-w-sm">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" required value={password}
               onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in…" : "Log in"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Build the page**

```tsx
// app/(auth)/login/page.tsx
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="space-y-6 w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <LoginForm />
        <p className="text-sm text-muted-foreground">
          New here? <Link href="/signup" className="underline">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/\(auth\)/login components/auth/login-form.tsx
git commit -m "feat(auth): login form + page"
```

---

## Task 16: Auth callback route

**Files:**
- Create: `app/(auth)/auth/callback/route.ts`

- [ ] **Step 1: Write callback**

```ts
// app/(auth)/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login", url.origin));

  const supa = await createSupabaseServer();
  const { error } = await supa.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin)
    );
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(auth\)/auth
git commit -m "feat(auth): email confirmation callback exchanges code for session"
```

---

## Task 17: App shell — protected layout, top nav, home page

**Files:**
- Create: `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `components/nav/top-nav.tsx`, `actions/auth.ts`
- Delete: `app/page.tsx` (was the "Hello" placeholder; the `(app)` group now provides `/`)

- [ ] **Step 1: Logout Server Action**

```ts
// actions/auth.ts
"use server";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function logout() {
  const supa = await createSupabaseServer();
  await supa.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: Top nav with logout**

```tsx
// components/nav/top-nav.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";

export function TopNav({ email }: { email: string }) {
  return (
    <header className="border-b">
      <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link href="/" className="font-semibold">Trello Clone</Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{email}</span>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">Log out</Button>
          </form>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Protected layout**

```tsx
// app/(app)/layout.tsx
import { requireUser } from "@/lib/auth";
import { TopNav } from "@/components/nav/top-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <TopNav email={user.email ?? ""} />
      <div className="max-w-6xl mx-auto p-6">{children}</div>
    </>
  );
}
```

- [ ] **Step 4: Workspace home placeholder**

```tsx
// app/(app)/page.tsx
import { dbAsUser } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await dbAsUser(token, async (tx) =>
    tx.select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
  );

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">Your workspaces</h1>
      <ul className="space-y-2">
        {ws.map(w => (
          <li key={w.id} className="rounded border p-3">{w.name}</li>
        ))}
      </ul>
      {ws.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No workspaces yet (UI to create them ships in plan #2).
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Remove old placeholder root page**

```bash
rm app/page.tsx
```

- [ ] **Step 6: Smoke test**

```bash
npm run dev &
sleep 5
# unauthenticated → should redirect to /login (HTTP 307)
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill %1
```

Expected: `307`.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\) components/nav actions/auth.ts
git rm app/page.tsx
git commit -m "feat(app): protected shell, top nav, workspace home"
```

---

## Task 18: E2E — signup → confirm → home → logout

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Playwright config**

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    timeout: 60_000,
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

- [ ] **Step 2: E2E test using Inbucket for confirmation link**

```ts
// tests/e2e/auth.spec.ts
import { test, expect, request as pwRequest } from "@playwright/test";

const INBUCKET = "http://127.0.0.1:54324";

async function fetchConfirmLink(email: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: INBUCKET });
  // Inbucket REST: GET /api/v1/mailbox/{user}
  const user = email.split("@")[0];
  for (let i = 0; i < 30; i++) {
    const res = await api.get(`/api/v1/mailbox/${user}`);
    if (res.ok()) {
      const msgs = await res.json();
      if (msgs.length) {
        const msg = await (await api.get(`/api/v1/mailbox/${user}/${msgs[0].id}`)).json();
        const html: string = msg.body.html ?? msg.body.text ?? "";
        const m = html.match(/href="([^"]+\/auth\/confirm[^"]+)"/)
              ?? html.match(/(http:\/\/[^\s"]+\/auth\/v1\/verify[^\s"]+)/);
        if (m) return m[1];
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("no confirmation email arrived");
}

test("signup → confirm → home → logout", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  const link = await fetchConfirmLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /your workspaces/i })).toBeVisible();
  await expect(page.getByText(/Workspace$/)).toBeVisible();

  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 3: Add scripts**

In `package.json` `"scripts"` add:

```json
"test:unit": "vitest run",
"test:e2e": "playwright test",
"db:reset": "supabase db reset"
```

- [ ] **Step 4: Run E2E**

```bash
npx playwright test
```

Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e package.json
git commit -m "test(e2e): signup→confirm→home→logout golden path"
```

---

## Task 19: README quickstart

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write quickstart**

```markdown
# Trello Clone

Foundation slice. Auth + RLS-backed workspaces. UI for boards/lists/cards ships in subsequent plans.

## Prereqs

- Node 20+, Docker, `supabase` CLI

## Quickstart

```bash
supabase start
{ supabase status -o env; echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres"; } > .env.local
npm install
npm run dev   # http://localhost:3000
```

## Tests

```bash
npm run test:unit   # vitest (unit + integration; needs supabase running)
npm run test:e2e    # playwright (needs npm run dev OR auto-starts via webServer)
```

## Reset DB

```bash
npm run db:reset
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README quickstart"
```

---

## Verification (run before declaring plan complete)

- [ ] `supabase start` is running
- [ ] `npm run test:unit` → all tests pass
- [ ] `npm run test:e2e` → 1 passed
- [ ] Manual smoke:
  - Visit `/` while logged out → redirected to `/login`
  - Sign up with `manual-$(date +%s)@example.com` / `passw0rd!`
  - Open Inbucket at http://127.0.0.1:54324, click confirm link
  - Should land on `/`, see one workspace named like `manual-…'s Workspace`
  - Click "Log out" → back to `/login`

If any of these fail, do not declare the plan complete.

---

## Self-Review Notes

- **Spec coverage in scope:** auth (§7), foundation tables (§4 subset), RLS (§4.5 subset), Drizzle with RLS (§3 + §10), middleware (§7), file structure (§8 subset). Realtime, drag-drop, card features explicitly deferred per plan header.
- **Placeholders:** none. Every step has runnable code or commands.
- **Type consistency:** `dbAsUser(jwt, fn)` signature is identical in Tasks 10 and 17. `requireUser` returns `User` (Supabase auth user) in Tasks 11 and 17.
- **Known fragility:** `lib/db/schema.ts` Task 6 imports `timestamptz` as if it were exported by `drizzle-orm/pg-core` — it is not. The implementing engineer should swap the alias for `timestamp("name", { withTimezone: true })`. The test in Step 7 will catch this mismatch.
- **Inbucket scraping** in the E2E test depends on Supabase confirmation email format; if Inbucket returns nothing the helper throws after 15 s, which surfaces as a test failure with a clear message rather than a hang.
