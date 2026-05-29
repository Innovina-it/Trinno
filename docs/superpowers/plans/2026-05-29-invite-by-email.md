# Invite-by-email for new users (owner/admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workspace owners/admins invite a brand-new person by email (any domain), who receives an invite, sets a password, and lands already a member of the inviting workspace — without weakening the `innovina.it` gate on public `/signup`.

**Architecture:** A new `workspace_invitations` table records outstanding invites and drives three things: a carve-out in the existing *Before User Created* domain hook (pending invite → any domain allowed), a "Pending" badge in the roster, and resend/revoke. The invite action auto-detects existing-vs-new users: existing → direct membership add (today's behavior); new → `admin.inviteUserByEmail` (Supabase native invite + set-password) plus an immediate membership row. An `auth.users` AFTER UPDATE trigger flips the invitation to `accepted` when the user confirms.

**Tech Stack:** Next.js App Router, Supabase (auth + Postgres + RLS), Drizzle ORM, Zod, Vitest (integration), Resend (resend email channel).

**Spec:** `docs/superpowers/specs/2026-05-29-invite-by-email-design.md`

---

## Conventions for every task

- **Run a single test file:** `npm run test:unit -- tests/integration/<file>.test.ts`
- **Apply migrations:** `supabase migration up`  ⚠️ **NEVER** `supabase db reset` / `npm run db:reset` — it wipes local data + auth users and breaks login. (Project rule.)
- **Lint:** `npm run lint`
- Integration tests require a running local Supabase (`supabase start`) with `.env.local` populated (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`). The existing suite already depends on this.
- **Known constraint:** the domain hook (`auth_block_external_domains`) is wired only in hosted Supabase Studio, NOT in local/test (the existing suite creates `@x.io` users via `admin.createUser`, which proves the hook is not enforced locally). Therefore the carve-out is verified by **calling the SQL function directly** (Task 2), never by relying on hook enforcement during `inviteUserByEmail`. Do **not** enable the hook in `config.toml` — it would break the existing suite.

## File map

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `supabase/migrations/0115_workspace_invitations.sql` | Create | Table + RLS + indexes |
| `supabase/migrations/0116_invite_domain_carveout.sql` | Create | `create or replace` domain hook with pending-invite bypass |
| `supabase/migrations/0117_invite_accept_trigger.sql` | Create | AFTER UPDATE trigger marks invitation accepted |
| `lib/db/schema.ts` | Modify | Add `workspaceInvitations` Drizzle table |
| `actions/workspace-members.ts` | Modify | Rewrite `inviteMemberImpl`; extend `removeMemberImpl`; add `resendInvitationImpl`/`resendInvitation` |
| `lib/invite-email.ts` | Create | `sendInviteEmail` — generateLink + Resend |
| `lib/queries/workspaces.ts` | Modify | `listMembers` left-joins invitations → `pending` flag |
| `components/workspace/member-list.tsx` | Modify | Render "Pending" badge + Resend; revoke via existing Remove |
| `components/workspace/invite-member-form.tsx` | Modify | Allow submit when no existing user; toast by result kind |
| `app/(auth)/accept-invite/page.tsx` | Create | Set-password landing (clone of reset-password) |
| `components/auth/accept-invite-form.tsx` | Create | `updateUser({password})` + redirect into workspace |
| `actions/auth.ts` | Modify | Add `inviteWorkspaceRedirect()` returning the invitee's workspace id |
| `tests/integration/workspace-invitations.test.ts` | Create | Table/RLS/unique, invite action, accept trigger, resend, revoke |
| `tests/integration/invite-domain-carveout.test.ts` | Create | Direct domain-hook function tests |

---

## Task 1: `workspace_invitations` table + Drizzle model

**Files:**
- Create: `supabase/migrations/0115_workspace_invitations.sql`
- Modify: `lib/db/schema.ts` (after `workspaceMembers`, ~line 67)
- Test: `tests/integration/workspace-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/workspace-invitations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(email: string) {
  const { data } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email,
    password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

function userClient(jwt: string) {
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

describe("workspace_invitations table + RLS", () => {
  it("admin can insert/select; non-member cannot select; pending is unique", async () => {
    const a = await makeUser(`inv-a-${Date.now()}@x.io`);
    const b = await makeUser(`inv-b-${Date.now()}@x.io`);
    const aCli = userClient(a.jwt);
    const bCli = userClient(b.jwt);

    const { data: ws } = await aCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `pending-${Date.now()}@gmail.com`;

    // Owner (admin) inserts a pending invitation.
    const { error: insErr } = await aCli.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      status: "pending",
    });
    expect(insErr).toBeNull();

    // Owner can read it.
    const { data: aSees } = await aCli
      .from("workspace_invitations")
      .select("email,status")
      .eq("workspace_id", wsId);
    expect(aSees?.some((r) => r.email === email)).toBe(true);

    // Non-member cannot read it.
    const { data: bSees } = await bCli
      .from("workspace_invitations")
      .select("email")
      .eq("workspace_id", wsId);
    expect(bSees?.length ?? 0).toBe(0);

    // Duplicate pending invite for same (workspace, email) is rejected.
    const { error: dupErr } = await aCli.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      status: "pending",
    });
    expect(dupErr).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: FAIL — relation `public.workspace_invitations` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0115_workspace_invitations.sql`:

```sql
-- Workspace invitations: outstanding invites for new (or existing) users.
-- One row drives (a) the domain-hook carve-out, (b) the roster "Pending"
-- badge, (c) resend/revoke. See migration 0116 (carve-out) + 0117 (accept).

create table public.workspace_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,                                  -- stored lowercased by the action
  role         public.workspace_role not null
                 check (role in ('admin','member','guest')),   -- never 'owner'
  invited_by   uuid not null references public.profiles(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending','accepted','revoked')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

create index workspace_invitations_workspace_idx
  on public.workspace_invitations (workspace_id);
create index workspace_invitations_email_idx
  on public.workspace_invitations (lower(email));

-- No duplicate LIVE invite per (workspace, email).
create unique index workspace_invitations_pending_uq
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';

alter table public.workspace_invitations enable row level security;

-- Read: any workspace member. Write: workspace admins/owner.
-- Mirrors workspace_members policies (migration 0003_rls.sql:103-109).
create policy ws_invitations_select on public.workspace_invitations for select
  using (public.is_workspace_member(workspace_invitations.workspace_id, auth.uid()));

create policy ws_invitations_admin_write on public.workspace_invitations for all
  using (public.is_workspace_admin(workspace_invitations.workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_invitations.workspace_id, auth.uid()));
```

- [ ] **Step 4: Add the Drizzle table**

In `lib/db/schema.ts`, immediately after the `workspaceMembers` definition (the block ending at line 67), add:

```ts
export const workspaceInvitations = pgTable("workspace_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  email: text("email").notNull(),
  role: workspaceRole("role").notNull(),
  invitedBy: uuid("invited_by").notNull(),
  userId: uuid("user_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});
```

- [ ] **Step 5: Apply the migration**

Run: `supabase migration up`
Expected: applies `0115_workspace_invitations` with no error.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0115_workspace_invitations.sql lib/db/schema.ts tests/integration/workspace-invitations.test.ts
git commit -m "feat(invitations): add workspace_invitations table + RLS"
```

---

## Task 2: Domain-hook carve-out for pending invites

**Files:**
- Create: `supabase/migrations/0116_invite_domain_carveout.sql`
- Test: `tests/integration/invite-domain-carveout.test.ts`

This `create or replace`s `auth_block_external_domains` (migration 0056) — it does **not** edit 0056 in place. The test calls the function directly over a raw Postgres connection (DATABASE_URL → local `postgres` superuser, which bypasses the `revoke ... from authenticated` grant).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/invite-domain-carveout.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
afterAll(async () => {
  await sql.end();
});

async function gate(email: string): Promise<Record<string, unknown>> {
  const event = JSON.stringify({ user: { email } });
  const [row] = await sql`
    select public.auth_block_external_domains(${event}::jsonb) as result
  `;
  return row.result as Record<string, unknown>;
}

describe("auth_block_external_domains carve-out", () => {
  it("blocks an external domain with no pending invite", async () => {
    const r = await gate(`stranger-${Date.now()}@gmail.com`);
    expect(r.error).toBeTruthy();
  });

  it("allows an internal domain", async () => {
    const r = await gate(`someone-${Date.now()}@innovina.it`);
    expect(r).toEqual({});
  });

  it("allows an external domain that has a pending invitation", async () => {
    // Seed: a workspace owner + a pending invitation for an external email.
    const email = `invited-${Date.now()}@gmail.com`;
    // workspaces.owner_id + workspace_invitations.invited_by both FK profiles(id),
    // so seed the owner from profiles (which has a row per auth user via 0110).
    const [{ id: ownerId }] = await sql`
      select id from public.profiles limit 1
    `;
    const [{ id: wsId }] = await sql`
      insert into public.workspaces (name, owner_id)
      values ('carveout-ws', ${ownerId}) returning id
    `;
    await sql`
      insert into public.workspace_invitations
        (workspace_id, email, role, invited_by, status)
      values (${wsId}, ${email}, 'member', ${ownerId}, 'pending')
    `;

    const r = await gate(email);
    expect(r).toEqual({}); // allowed despite @gmail.com

    // Revoked invite no longer grants the bypass.
    await sql`
      update public.workspace_invitations
         set status = 'revoked' where email = ${email}
    `;
    const r2 = await gate(email);
    expect(r2.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/integration/invite-domain-carveout.test.ts`
Expected: FAIL on the third test — the current function ignores invitations, so an `@gmail.com` email returns an error even with a pending invite.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0116_invite_domain_carveout.sql`:

```sql
-- Domain-gate carve-out: allow signup/user-creation for any email that has
-- a LIVE (pending) workspace invitation. Public /signup for un-invited
-- external emails stays blocked (innovina.it allowlist unchanged).
--
-- This redefines the hook from migration 0056; the function body is
-- identical except for the prepended invitation check.

create or replace function public.auth_block_external_domains(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_domains text[] := array['innovina.it'];
  email text;
  email_domain text;
begin
  email := event->'user'->>'email';
  email_domain := lower(split_part(coalesce(email, ''), '@', 2));

  if email_domain is null or email_domain = '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Email is required.'
      )
    );
  end if;

  -- Carve-out: an outstanding (pending) invitation authorizes any domain.
  if exists (
    select 1 from public.workspace_invitations wi
     where wi.email = lower(email)
       and wi.status = 'pending'
  ) then
    return '{}'::jsonb;
  end if;

  if not (email_domain = any (allowed_domains)) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', format(
          'Signup is restricted to internal addresses (%s not allowed).',
          email_domain
        )
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant execute
  on function public.auth_block_external_domains(jsonb)
  to supabase_auth_admin;

revoke execute
  on function public.auth_block_external_domains(jsonb)
  from authenticated, anon, public;
```

- [ ] **Step 4: Apply the migration**

Run: `supabase migration up`
Expected: applies `0116_invite_domain_carveout`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- tests/integration/invite-domain-carveout.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0116_invite_domain_carveout.sql tests/integration/invite-domain-carveout.test.ts
git commit -m "feat(invitations): carve out domain gate for pending invites"
```

---

## Task 3: Acceptance trigger — flip invitation to `accepted`

**Files:**
- Create: `supabase/migrations/0117_invite_accept_trigger.sql`
- Test: add to `tests/integration/workspace-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `tests/integration/workspace-invitations.test.ts` (reuse the `service`/`url`/`anon`/`makeUser`/`userClient` helpers already in the file):

```ts
describe("invitation acceptance trigger", () => {
  it("flips status to accepted when the user confirms their email", async () => {
    const a = await makeUser(`acc-owner-${Date.now()}@x.io`);
    const aCli = userClient(a.jwt);
    const { data: ws } = await aCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;

    // Create an unconfirmed invitee + a pending invitation pointing at them.
    const email = `acc-invitee-${Date.now()}@gmail.com`;
    const { data: created } = await service.auth.admin.createUser({
      email,
      email_confirm: false,
    });
    const inviteeId = created.user!.id;
    await service.from("workspace_invitations").insert({
      workspace_id: wsId,
      email,
      role: "member",
      invited_by: a.id,
      user_id: inviteeId,
      status: "pending",
    });

    // Simulate acceptance: confirm the email.
    await service.auth.admin.updateUserById(inviteeId, { email_confirm: true });

    const { data: after } = await service
      .from("workspace_invitations")
      .select("status, accepted_at")
      .eq("user_id", inviteeId)
      .single();
    expect(after!.status).toBe("accepted");
    expect(after!.accepted_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: FAIL on the new test — status stays `pending` (no trigger yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0117_invite_accept_trigger.sql`:

```sql
-- Mark a workspace invitation 'accepted' the moment the invitee confirms
-- their email (i.e. clicks the invite link and sets a password). Matches
-- by user_id OR email so it is robust whether or not user_id was stamped.
-- Consistent with the existing auth.users trigger (handle_new_user, 0110).

create or replace function public.handle_invite_accept()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null then
    update public.workspace_invitations
       set status = 'accepted',
           accepted_at = now()
     where status = 'pending'
       and (user_id = new.id or lower(email) = lower(new.email));
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row
  execute function public.handle_invite_accept();
```

- [ ] **Step 4: Apply the migration**

Run: `supabase migration up`
Expected: applies `0117_invite_accept_trigger`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0117_invite_accept_trigger.sql tests/integration/workspace-invitations.test.ts
git commit -m "feat(invitations): mark invite accepted on email confirm"
```

---

## Task 4: Rewrite `inviteMemberImpl` — auto-detect existing vs new

**Files:**
- Modify: `actions/workspace-members.ts` (replace `inviteMemberImpl` at lines 42-75; update imports + the `inviteMember` wrapper at 125-131)
- Test: add to `tests/integration/workspace-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/workspace-invitations.test.ts`:

```ts
import { inviteMemberImpl } from "@/actions/workspace-members";

describe("inviteMemberImpl auto-detect", () => {
  it("adds an existing user directly with no invitation row", async () => {
    const owner = await makeUser(`own1-${Date.now()}@x.io`);
    const existing = await makeUser(`exist-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;

    // Look up the existing user's email from auth.
    const { data: eu } = await service.auth.admin.getUserById(existing.id);
    const email = eu.user!.email!;

    const res = await inviteMemberImpl(owner.jwt, {
      workspaceId: wsId,
      email,
      role: "member",
    });
    expect(res.kind).toBe("added");
    expect(res.userId).toBe(existing.id);

    const { data: inv } = await service
      .from("workspace_invitations")
      .select("id")
      .eq("workspace_id", wsId);
    expect(inv?.length ?? 0).toBe(0);

    const { data: mem } = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", wsId)
      .eq("user_id", existing.id);
    expect(mem?.length).toBe(1);
  });

  it("invites a brand-new email: invitation + membership + auth user", async () => {
    const owner = await makeUser(`own2-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `fresh-${Date.now()}@gmail.com`;

    const res = await inviteMemberImpl(owner.jwt, {
      workspaceId: wsId,
      email,
      role: "member",
    });
    expect(res.kind).toBe("invited");

    const { data: inv } = await service
      .from("workspace_invitations")
      .select("status, user_id")
      .eq("workspace_id", wsId)
      .eq("email", email)
      .single();
    expect(inv!.status).toBe("pending");
    expect(inv!.user_id).toBe(res.userId);

    const { data: mem } = await service
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", wsId)
      .eq("user_id", res.userId);
    expect(mem?.length).toBe(1);

    const { data: u } = await service.auth.admin.getUserById(res.userId);
    expect(u.user?.email).toBe(email);
  });

  it("rejects a duplicate pending invite for the same email", async () => {
    const owner = await makeUser(`own3-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `dup-${Date.now()}@gmail.com`;

    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    await expect(
      inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: FAIL — current `inviteMemberImpl` throws "No user with that email" for the new-email case and returns the bare member row (no `kind`).

- [ ] **Step 3: Update imports in `actions/workspace-members.ts`**

Replace the import block at the top (lines 1-10) so it includes the new symbols:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq, isNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers, workspaceInvitations } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  InviteMemberInput, ChangeMemberRoleInput, RemoveMemberInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";
import { getServiceSupabase } from "@/lib/supabase/service-role";
```

- [ ] **Step 4: Replace `inviteMemberImpl` (lines 42-75)**

```ts
export type InviteResult = { kind: "added" | "invited"; userId: string };

export async function inviteMemberImpl(
  token: string,
  input: { workspaceId: string; email: string; role: "admin" | "member" | "guest" },
): Promise<InviteResult> {
  const parsed = InviteMemberInput.parse(input);
  const email = parsed.email.toLowerCase();
  const actorId = decodeSub(token);

  // 1. Authorize + detect whether the email already has an account (RLS tx).
  const existingUserId = await dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${email}) as id`,
    );
    return (lookup as unknown as { id: string | null }[])[0]?.id ?? null;
  });

  // 2a. Existing user → direct add (preserves prior behavior).
  if (existingUserId) {
    await dbAsUser(token, async (tx) => {
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: parsed.workspaceId, userId: existingUserId, role: parsed.role })
        .onConflictDoNothing();
    });
    return { kind: "added", userId: existingUserId };
  }

  // 2b. New email → guard against a duplicate live invite, then create the
  // pending invitation BEFORE inviting (the before-user-created hook reads it).
  await dbAsUser(token, async (tx) => {
    const [dup] = await tx
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, parsed.workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
      ))
      .limit(1);
    if (dup) {
      throw new StructuredError("ALREADY_INVITED", "An invite is already pending for this email.");
    }
    await tx.insert(workspaceInvitations).values({
      workspaceId: parsed.workspaceId,
      email,
      role: parsed.role,
      invitedBy: actorId,
      status: "pending",
    });
  });

  // 3. Native Supabase invite (creates the unconfirmed user + emails the link).
  const sb = getServiceSupabase();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/accept-invite`;
  try {
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (error || !data?.user) {
      // Race: the email got registered between step 1 and now → fall back to direct add.
      if (error?.message?.toLowerCase().includes("already")) {
        const retryId = await dbAsUser(token, async (tx) => {
          const r = await tx.execute(sql`select public.find_user_id_by_email(${email}) as id`);
          return (r as unknown as { id: string | null }[])[0]?.id ?? null;
        });
        if (retryId) {
          await dbAsUser(token, async (tx) => {
            await tx
              .update(workspaceInvitations)
              .set({ status: "revoked" })
              .where(and(
                eq(workspaceInvitations.workspaceId, parsed.workspaceId),
                eq(workspaceInvitations.email, email),
                eq(workspaceInvitations.status, "pending"),
              ));
            await tx
              .insert(workspaceMembers)
              .values({ workspaceId: parsed.workspaceId, userId: retryId, role: parsed.role })
              .onConflictDoNothing();
          });
          return { kind: "added", userId: retryId };
        }
      }
      throw new StructuredError("INVITE_FAILED", error?.message ?? "Failed to send invitation");
    }

    const newUserId = data.user.id;
    await dbAsUser(token, async (tx) => {
      await tx
        .update(workspaceInvitations)
        .set({ userId: newUserId })
        .where(and(
          eq(workspaceInvitations.workspaceId, parsed.workspaceId),
          eq(workspaceInvitations.email, email),
          eq(workspaceInvitations.status, "pending"),
        ));
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: parsed.workspaceId, userId: newUserId, role: parsed.role })
        .onConflictDoNothing();
    });
    return { kind: "invited", userId: newUserId };
  } catch (e) {
    // Roll back the bypass-granting invitation so it cannot linger.
    await dbAsUser(token, async (tx) => {
      await tx.delete(workspaceInvitations).where(and(
        eq(workspaceInvitations.workspaceId, parsed.workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
        isNull(workspaceInvitations.userId),
      ));
    });
    throw StructuredError.fromUnknown(e, "INVITE_FAILED");
  }
}
```

- [ ] **Step 5: Update the `inviteMember` wrapper (lines 125-131)**

The wrapper already returns `inviteMemberImpl`'s value; just ensure the return type flows. Confirm it reads:

```ts
export async function inviteMember(input: Parameters<typeof inviteMemberImpl>[1]): Promise<InviteResult> {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await inviteMemberImpl(token, input);
  revalidateWorkspace(input.workspaceId);
  return r;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 7: Run the full integration suite for regressions**

Run: `npm run test:unit -- tests/integration/forbidden-codes.test.ts tests/integration/rls.test.ts`
Expected: PASS — existing member/RLS behavior unchanged.

- [ ] **Step 8: Commit**

```bash
git add actions/workspace-members.ts tests/integration/workspace-invitations.test.ts
git commit -m "feat(invitations): invite-by-email for new users with auto-detect"
```

---

## Task 5: Roster `pending` flag + "Pending" badge

**Files:**
- Modify: `lib/queries/workspaces.ts` (`listMembers`, lines 70-83)
- Modify: `components/workspace/member-list.tsx` (`Member` type + render)
- Test: add to `tests/integration/workspace-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/workspace-invitations.test.ts`:

```ts
import { listMembers } from "@/lib/queries/workspaces";

describe("listMembers pending flag", () => {
  it("flags an invited-but-unaccepted member as pending", async () => {
    const owner = await makeUser(`pend-own-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `pend-${Date.now()}@gmail.com`;

    const res = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });

    const members = await listMembers(owner.jwt, wsId);
    const ow: any = members.find((m: any) => m.userId === owner.id);
    const inv: any = members.find((m: any) => m.userId === res.userId);
    expect(ow.pending).toBe(false);
    expect(inv.pending).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: FAIL — `pending` is `undefined` (listMembers doesn't select it).

- [ ] **Step 3: Update `listMembers` (lines 70-83)**

```ts
export async function listMembers(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
        pendingId: workspaceInvitations.id,
      })
      .from(workspaceMembers)
      .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .leftJoin(
        workspaceInvitations,
        and(
          eq(workspaceInvitations.workspaceId, workspaceMembers.workspaceId),
          eq(workspaceInvitations.userId, workspaceMembers.userId),
          eq(workspaceInvitations.status, "pending"),
        ),
      )
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return rows.map(({ pendingId, ...m }) => ({ ...m, pending: pendingId !== null }));
  });
}
```

Add `workspaceInvitations` to the import at the top of `lib/queries/workspaces.ts`:

```ts
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  boards,
  profiles,
} from "@/lib/db/schema";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the badge in `member-list.tsx`**

Extend the `Member` type (lines 11-16) with `pending` and import `resendInvitation` (created in Task 7 — if executing strictly in order, add the import in Task 7; the badge alone needs no new action):

```ts
type Member = {
  userId: string;
  role: "owner" | "admin" | "member" | "guest";
  displayName: string;
  avatarUrl: string | null;
  pending: boolean;
};
```

In the row, after the role `<Badge>` (line 41), add a pending badge:

```tsx
<Badge variant="outline">{m.role}</Badge>
{m.pending && (
  <Badge variant="outline" className="text-fg-faint">
    Pending · invite sent
  </Badge>
)}
```

- [ ] **Step 6: Verify the page typechecks**

Run: `npm run lint`
Expected: no errors. (`listMembers` now returns `pending`, satisfying the `Member` type passed from `app/(app)/w/[workspaceId]/settings/page.tsx`.)

- [ ] **Step 7: Commit**

```bash
git add lib/queries/workspaces.ts components/workspace/member-list.tsx tests/integration/workspace-invitations.test.ts
git commit -m "feat(invitations): show pending invitees in the roster"
```

---

## Task 6: Invite form — allow inviting non-existent users

**Files:**
- Modify: `components/workspace/invite-member-form.tsx`

This is a client component that imports `@/components/ui/*` (base-ui). Per project constraint, base-ui components are not unit-testable under Vitest — **verify manually** (Task 10 covers end-to-end). No test step here.

- [ ] **Step 1: Update the preview copy + submit gate**

In `components/workspace/invite-member-form.tsx`:

Replace the `missing` preview branch (lines 105-109) so it reads as invitable, not blocked:

```tsx
{preview.state === "missing" && (
  <span className="text-fg-muted">
    NEW PERSON — WE&apos;LL EMAIL AN INVITE TO SET A PASSWORD
  </span>
)}
```

Replace the submit button's `disabled` (line 133) to no longer block on `missing`:

```tsx
disabled={pending || !email}
```

- [ ] **Step 2: Toast by result kind**

Replace the `submit` handler body (lines 64-76) so the toast reflects whether the person was added or invited:

```tsx
function submit(e: React.FormEvent) {
  e.preventDefault();
  start(async () => {
    try {
      const res = await inviteMember({ workspaceId, email, role });
      setEmail("");
      setPreview({ state: "idle" });
      toast.success(res.kind === "invited" ? "Invite sent" : "Added to workspace");
    } catch (err) {
      toast.error((err as Error).message);
    }
  });
}
```

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/invite-member-form.tsx
git commit -m "feat(invitations): let the invite form invite new people by email"
```

---

## Task 7: Resend invitation (action + email helper)

**Files:**
- Create: `lib/invite-email.ts`
- Modify: `actions/workspace-members.ts` (add `resendInvitationImpl` + `resendInvitation`; add validation import)
- Modify: `lib/validation.ts` (add `ResendInvitationInput`)
- Modify: `components/workspace/member-list.tsx` (Resend button on pending rows)
- Test: add to `tests/integration/workspace-invitations.test.ts`

> **Verify during implementation:** `generateLink({ type: 'invite' })` for an already-created *unconfirmed* user. If the local Supabase rejects it ("user already exists"), switch the helper to `type: 'magiclink'` (login link) — both deliver the user to a session on `/accept-invite` where they set a password. The action/test below assert behavior (completes on pending, throws on non-pending), not the Supabase link internals.

- [ ] **Step 1: Add the validation schema**

In `lib/validation.ts`, after `RemoveMemberInput` (line 46):

```ts
export const ResendInvitationInput = z.object({
  workspaceId: Uuid,
  email: Email,
});
```

- [ ] **Step 2: Write the email helper**

Create `lib/invite-email.ts`:

```ts
import { getServiceSupabase } from "@/lib/supabase/service-role";

// Re-issues a Supabase invite link for an already-created (unconfirmed)
// invitee and delivers it via Resend (the same channel as notify-email).
// Soft-fails in dev when RESEND_API_KEY is unset — the link is still
// generated server-side; only delivery is skipped.
export async function sendInviteEmail(
  email: string,
  workspaceName: string,
): Promise<void> {
  const sb = getServiceSupabase();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/accept-invite`;
  const { data, error } = await sb.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(error?.message ?? "Could not generate invite link");
  }
  const link = data.properties.action_link;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return; // dev soft-fail; link generated, delivery skipped
  const fromAddr = process.env.RESEND_FROM ?? "Trinno <notifications@trinno.local>";

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #fafafa; background: #0a0a0a; padding: 24px;">
      <p style="margin: 0 0 8px 0; font-size: 16px;">You've been invited to <strong>${workspaceName}</strong> on Trinno.</p>
      <p style="margin: 0 0 24px 0;"><a href="${link}" style="color: #38bdf8;">Accept the invite &amp; set your password</a></p>
    </div>`;
  const text = `You've been invited to ${workspaceName} on Trinno.\nAccept and set your password: ${link}`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromAddr, to: [email], subject: `Invitation to ${workspaceName}`, html, text }),
  });
  if (!r.ok) {
    console.error("[invite-email] resend error", r.status, await r.text());
  }
}
```

- [ ] **Step 3: Write the failing test**

Append to `tests/integration/workspace-invitations.test.ts`:

```ts
import { resendInvitationImpl } from "@/actions/workspace-members";

describe("resendInvitation", () => {
  it("succeeds for a pending invite, throws for an unknown one", async () => {
    const owner = await makeUser(`res-own-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `res-${Date.now()}@gmail.com`;

    await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });

    await expect(
      resendInvitationImpl(owner.jwt, { workspaceId: wsId, email }),
    ).resolves.toBeUndefined();

    await expect(
      resendInvitationImpl(owner.jwt, { workspaceId: wsId, email: `nobody-${Date.now()}@gmail.com` }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: FAIL — `resendInvitationImpl` is not exported.

- [ ] **Step 5: Add the action**

In `actions/workspace-members.ts`, add the validation + helper imports:

```ts
import {
  InviteMemberInput, ChangeMemberRoleInput, RemoveMemberInput, ResendInvitationInput,
} from "@/lib/validation";
import { sendInviteEmail } from "@/lib/invite-email";
import { workspaces } from "@/lib/db/schema"; // add alongside existing schema import
```

(If `workspaces` is already imported elsewhere in the file, merge — do not duplicate the import.)

Add after `inviteMemberImpl`:

```ts
export async function resendInvitationImpl(
  token: string,
  input: { workspaceId: string; email: string },
): Promise<void> {
  const parsed = ResendInvitationInput.parse(input);
  const email = parsed.email.toLowerCase();
  const actorId = decodeSub(token);

  const workspaceName = await dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);
    const [inv] = await tx
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(and(
        eq(workspaceInvitations.workspaceId, parsed.workspaceId),
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
      ))
      .limit(1);
    if (!inv) {
      throw new StructuredError("NOT_FOUND", "No pending invitation for that email.");
    }
    const [ws] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, parsed.workspaceId))
      .limit(1);
    return ws?.name ?? "your workspace";
  });

  await sendInviteEmail(email, workspaceName);
}

export async function resendInvitation(input: Parameters<typeof resendInvitationImpl>[1]): Promise<void> {
  await requireUser();
  const token = (await getSessionToken())!;
  await resendInvitationImpl(token, input);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: PASS. (With no `RESEND_API_KEY` in `.env.local`, `sendInviteEmail` generates the link then soft-returns; the pending case resolves, the unknown case throws `NOT_FOUND`.)

- [ ] **Step 7: Wire the Resend button in `member-list.tsx`**

Add the import:

```ts
import { changeMemberRole, removeMember, resendInvitation } from "@/actions/workspace-members";
```

The roster needs the invitee's email to resend. Extend `Member` with `email?: string | null` and surface it from `listMembers` (add `email: workspaceInvitations.email` to the select in Task 5's query — update that select to also return `email: workspaceInvitations.email` and include it in the returned object). Then, inside the pending block, add a Resend button:

```tsx
{m.pending && m.email && (
  <Button
    size="sm"
    variant="outline"
    disabled={pending}
    onClick={() =>
      start(async () => {
        try {
          await resendInvitation({ workspaceId, email: m.email! });
          toast.success("Invite re-sent");
        } catch (err) {
          toast.error((err as Error).message);
        }
      })
    }
  >
    Resend
  </Button>
)}
```

Update the Task-5 `listMembers` select to include the email (so `member-list` has it):

```ts
.select({
  userId: workspaceMembers.userId,
  role: workspaceMembers.role,
  displayName: profiles.displayName,
  avatarUrl: profiles.avatarUrl,
  pendingId: workspaceInvitations.id,
  pendingEmail: workspaceInvitations.email,
})
// ...
return rows.map(({ pendingId, pendingEmail, ...m }) => ({
  ...m,
  pending: pendingId !== null,
  email: pendingEmail,
}));
```

And extend the `Member` type:

```ts
type Member = {
  userId: string;
  role: "owner" | "admin" | "member" | "guest";
  displayName: string;
  avatarUrl: string | null;
  pending: boolean;
  email?: string | null;
};
```

- [ ] **Step 8: Verify lint + full invitation test file**

Run: `npm run lint && npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: no lint errors; tests PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/invite-email.ts lib/validation.ts actions/workspace-members.ts components/workspace/member-list.tsx lib/queries/workspaces.ts tests/integration/workspace-invitations.test.ts
git commit -m "feat(invitations): resend pending invites"
```

---

## Task 8: Revoke a pending invitation on member removal

**Files:**
- Modify: `actions/workspace-members.ts` (`removeMemberImpl`, lines 97-111)
- Test: add to `tests/integration/workspace-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/workspace-invitations.test.ts`:

```ts
import { removeMemberImpl } from "@/actions/workspace-members";

describe("removeMember revokes a pending invitation", () => {
  it("removes the membership and marks the invitation revoked", async () => {
    const owner = await makeUser(`rev-own-${Date.now()}@x.io`);
    const ownerCli = userClient(owner.jwt);
    const { data: ws } = await ownerCli.from("workspaces").select("id");
    const wsId = ws![0].id as string;
    const email = `rev-${Date.now()}@gmail.com`;

    const res = await inviteMemberImpl(owner.jwt, { workspaceId: wsId, email, role: "member" });
    await removeMemberImpl(owner.jwt, { workspaceId: wsId, userId: res.userId });

    const { data: mem } = await service
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", wsId)
      .eq("user_id", res.userId);
    expect(mem?.length ?? 0).toBe(0);

    const { data: inv } = await service
      .from("workspace_invitations")
      .select("status")
      .eq("workspace_id", wsId)
      .eq("email", email)
      .single();
    expect(inv!.status).toBe("revoked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: FAIL — invitation stays `pending` after removal.

- [ ] **Step 3: Extend `removeMemberImpl` (lines 97-111)**

```ts
export async function removeMemberImpl(
  token: string,
  input: { workspaceId: string; userId: string },
) {
  const parsed = RemoveMemberInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await assertCanManageWorkspaceMembers(tx, parsed.workspaceId, actorId);
    const r = await tx.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, parsed.workspaceId),
      eq(workspaceMembers.userId, parsed.userId),
    )).returning({ userId: workspaceMembers.userId });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    // If this member was a not-yet-accepted invitee, revoke the invitation so
    // the domain-gate bypass evaporates.
    await tx.update(workspaceInvitations)
      .set({ status: "revoked" })
      .where(and(
        eq(workspaceInvitations.workspaceId, parsed.workspaceId),
        eq(workspaceInvitations.userId, parsed.userId),
        eq(workspaceInvitations.status, "pending"),
      ));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/integration/workspace-invitations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add actions/workspace-members.ts tests/integration/workspace-invitations.test.ts
git commit -m "feat(invitations): revoke invitation when removing a pending member"
```

---

## Task 9: `/accept-invite` set-password page

**Files:**
- Create: `app/(auth)/accept-invite/page.tsx`
- Create: `components/auth/accept-invite-form.tsx`
- Modify: `actions/auth.ts` (add `inviteWorkspaceRedirect`)

UI on base-ui → not Vitest-unit-testable; **verify manually in Task 10.** Mirrors `reset-password` page/form.

- [ ] **Step 1: Add the redirect-resolver action**

In `actions/auth.ts`, add (keep existing `logout` etc.):

```ts
"use server";
import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceInvitations } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";

// After an invitee sets their password, resolve which workspace to drop
// them into (the most recent invitation that names them). RLS lets them
// read invitations for workspaces they now belong to.
export async function inviteWorkspaceRedirect(): Promise<string | null> {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: workspaceInvitations.workspaceId })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.userId, user.id))
      .orderBy(desc(workspaceInvitations.createdAt))
      .limit(1);
    return row?.workspaceId ?? null;
  });
}
```

> If `actions/auth.ts` already has a `"use server"` line and imports, merge these in rather than duplicating. `requireUser()` returns the Supabase user (see `lib/auth.ts`); confirm it exposes `.id` and adjust if it returns a wrapper.

- [ ] **Step 2: Create the form component**

Create `components/auth/accept-invite-form.tsx` (clone of `reset-password-form.tsx` with invite copy + workspace redirect):

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { inviteWorkspaceRedirect } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendly(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("password")) return "Password must be at least 8 characters.";
  if (lower.includes("session") || lower.includes("token")) {
    return "Invite link expired or already used. Ask the workspace admin to resend it.";
  }
  return msg;
}

export function AcceptInviteForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    supa.auth.getSession().then(({ data }) => {
      if (!data.session) setErr("Invite link expired or invalid. Ask the admin to resend it.");
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const supa = createSupabaseBrowser();
    const { error } = await supa.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      setErr(friendly(error.message));
      return;
    }
    const wsId = await inviteWorkspaceRedirect();
    router.replace(wsId ? `/w/${wsId}` : "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 w-full" noValidate>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (err) setErr(null);
            }}
            aria-invalid={err ? "true" : undefined}
            placeholder="At least 8 characters"
            className="pr-10"
            autoFocus
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide" : "Show"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center size-7 rounded-md text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </div>

      {err && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-[color:var(--status-blocked)]/40 bg-[color:var(--status-blocked)]/10 px-3 py-2 text-sm"
          style={{ color: "var(--status-blocked)" }}
        >
          {err}
        </div>
      )}

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>Saving</span>
          </>
        ) : (
          <>
            <span>Set password &amp; join</span>
            <ChevronRight className="size-4 transition-transform duration-150 group-hover/button:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create the page**

Create `app/(auth)/accept-invite/page.tsx` (clone of reset-password page, invite copy):

```tsx
import Link from "next/link";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <main className="relative min-h-dvh flex flex-col">
      <div className="border-b border-hairline">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3.5">
          <span className="mono-meta text-fg-muted">
            <span className="text-fg font-semibold">Trinno</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg-muted">AUTH</span>
            <span className="text-fg-faint mx-1.5">/</span>
            <span className="text-fg">ACCEPT INVITE</span>
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <section className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
              Welcome — set your password
            </h1>
            <p className="text-sm text-fg-muted">
              Choose a password of at least 8 characters to join your workspace.
            </p>
          </div>

          <AcceptInviteForm />

          <div className="pt-4 border-t border-hairline">
            <p className="text-sm text-fg-muted">
              <Link
                href="/login"
                className="text-fg underline underline-offset-4 decoration-hairline-hi hover:decoration-fg"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify build/lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/(auth)/accept-invite/page.tsx components/auth/accept-invite-form.tsx actions/auth.ts
git commit -m "feat(invitations): accept-invite set-password page"
```

---

## Task 10: Config + manual end-to-end verification

**No code.** Verifies the pieces that integration tests can't (real email, real hook wiring, the UI).

- [ ] **Step 1: Local Supabase redirect allowlist**

Confirm `supabase/config.toml` `[auth]` `additional_redirect_urls` (or Studio → Auth → URL Configuration in hosted) includes the app origin + `/accept-invite`. Locally the default localhost allowlist is permissive; add `"http://localhost:3000/accept-invite"` if invite links 400 on redirect.

- [ ] **Step 2: Manual happy path (new external user)**

1. `supabase start` + `npm run dev`, sign in as an `innovina.it` owner.
2. Workspace → Settings → Members → invite `someone@gmail.com` as Member.
3. Expect toast "Invite sent"; the roster shows `someone@gmail.com` with **Pending · invite sent** + a **Resend** button.
4. Open the local mail catcher (Supabase Inbucket/Mailpit, default `http://localhost:54324`), open the invite email, click the link.
5. Land on `/accept-invite`; set a password; expect redirect into the inviting workspace.
6. Back in the owner's Settings → Members, the **Pending** badge is gone (status flipped to accepted).

- [ ] **Step 3: Manual guard — public signup still gated**

In an incognito window, go to `/signup` and try `random@gmail.com` (no invite). Expect rejection ("restricted to internal addresses") — **only** if the hook is wired in this environment (locally it may be unenforced; the carve-out logic itself is covered by Task 2's direct-function test).

- [ ] **Step 4: Manual — existing user add**

Invite an existing `innovina.it` teammate's email → toast "Added to workspace", no email sent, appears immediately (no Pending badge).

- [ ] **Step 5: Production prerequisites note**

Record in the PR description: hosted Supabase must (a) have the *Before User Created* hook pointed at `public.auth_block_external_domains` (already required for the existing gate), and (b) list the production `/accept-invite` URL in the Auth redirect allowlist. SMTP for invite emails: confirmed working since `forgot-password` already uses Supabase email.

- [ ] **Step 6: Full suite sanity**

Run: `npm run test:unit`
Expected: PASS (no regressions across the suite).

---

## Notes for the executor

- **Migration discipline:** apply with `supabase migration up` only. If a migration needs a fix after applying locally, write a new forward migration — don't rewrite an applied one (matches repo history numbering 0115→0117).
- **Service role:** the new-invite path uses `getServiceSupabase()` for `inviteUserByEmail`/`generateLink` only; all table writes go through `dbAsUser` (RLS as the actor), so the owner/admin gate is enforced by policy, not just by the TypeScript assertion.
- **Email in dev:** `inviteUserByEmail` sends via local Supabase mail; `sendInviteEmail` (resend) soft-fails without `RESEND_API_KEY`. Neither is asserted by tests.
