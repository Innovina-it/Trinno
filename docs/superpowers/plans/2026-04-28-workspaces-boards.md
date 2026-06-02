# Trello Clone — Workspaces & Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship workspace and board management on top of the foundation slice. Users can create new workspaces, invite members with roles, switch between workspaces, create/rename/archive/delete boards inside a workspace, and navigate to a board view (still a stub — lists/cards land in plan #3).

**Architecture:** All mutations go through Server Actions in `actions/*.ts` that call `dbAsUser(token, ...)` so RLS enforces authorization. Reads from Server Components also use `dbAsUser`. UI uses shadcn primitives (Dialog, DropdownMenu, AlertDialog) added on top of plan #1's base. The "currently viewed workspace" is derived from URL (`/w/[id]`); top-level `/` redirects to the user's most-recent workspace.

**Tech Stack:** Same as plan #1. New shadcn components added: dialog, dropdown-menu, alert-dialog, avatar, badge, separator. New runtime dep: none (`zod` already installed for input validation).

**Out of scope (deferred):** lists/cards (#3), realtime sync (#4), card features (#5), activity feed (#6), CI hardening (#7), workspace logos/avatars upload, workspace billing.

**Definition of done:**
- A signed-in user can create a second workspace, see it in the workspace switcher dropdown, and switch between workspaces.
- A workspace owner can rename and delete their workspace.
- A workspace owner/admin can invite an existing user (by email) as member/admin/observer, change a member's role, and remove a member.
- A workspace member can create a board in that workspace, see all boards in a grid on the workspace home, and click a board to navigate to `/b/[boardId]`.
- A board admin can rename, archive, and delete a board.
- The board view page renders the board title, background, and a "Lists go here (plan #3)" placeholder — fed by `dbAsUser` so RLS protects it.
- All mutations are RLS-enforced (an attacker calling a Server Action with another workspace's ID gets nothing).
- Integration tests cover RLS for workspace + board mutations. E2E test covers workspace creation + board creation + board nav.

---

## File Structure

**New Server Actions** (mutations only — every fn calls `requireUser()` + `dbAsUser`):
- `actions/workspaces.ts` — `createWorkspace`, `renameWorkspace`, `deleteWorkspace`, `setActiveWorkspace`
- `actions/workspace-members.ts` — `inviteMember`, `changeMemberRole`, `removeMember`
- `actions/boards.ts` — `createBoard`, `renameBoard`, `setBoardArchived`, `deleteBoard`

**New routes:**
- `app/(app)/page.tsx` — modify: redirect to most-recent `/w/[id]`, or render empty-state if none
- `app/(app)/w/[workspaceId]/page.tsx` — workspace home (board grid + create-board button)
- `app/(app)/w/[workspaceId]/settings/page.tsx` — workspace settings (rename, members, danger zone)
- `app/(app)/b/[boardId]/page.tsx` — board view (title, background, "lists placeholder")
- `app/(app)/b/[boardId]/settings/page.tsx` — board settings (rename, archive, delete)

**New components:**
- `components/workspace/workspace-switcher.tsx` — DropdownMenu in top nav
- `components/workspace/board-grid.tsx` — board tiles
- `components/workspace/create-workspace-dialog.tsx`
- `components/workspace/create-board-dialog.tsx`
- `components/workspace/member-list.tsx`
- `components/workspace/invite-member-form.tsx`
- `components/board/board-view.tsx` — board page body (stub for now)
- `components/board/board-settings-form.tsx`
- `components/ui/*` — added via shadcn: dialog, dropdown-menu, alert-dialog, avatar, badge, separator

**New lib:**
- `lib/queries/workspaces.ts` — read helpers (`listWorkspaces`, `getWorkspace`, `listMembers`)
- `lib/queries/boards.ts` — read helpers (`listBoardsInWorkspace`, `getBoard`)
- `lib/validation.ts` — zod schemas for action inputs

**New tests:**
- `tests/integration/actions/workspaces.test.ts`
- `tests/integration/actions/boards.test.ts`
- `tests/integration/actions/workspace-members.test.ts`
- `tests/integration/rls-extended.test.ts` — covers UPDATE/DELETE denial paths
- `tests/e2e/workspaces-boards.spec.ts`

**Modified:**
- `app/(app)/layout.tsx` — pass workspaces list to top nav
- `components/nav/top-nav.tsx` — render workspace switcher + workspace-aware logo link

---

## Task 1: Add shadcn primitives needed for this plan

**Files:** modifies `components/ui/*`, `package.json`

- [ ] **Step 1: Install primitives**

```bash
cd /home/innovina/Documents/trello-foundation
npx --yes shadcn@latest add dialog dropdown-menu alert-dialog avatar badge separator
```

- [ ] **Step 2: Confirm files exist**

```bash
ls components/ui/{dialog,dropdown-menu,alert-dialog,avatar,badge,separator}.tsx
```

Expected: 6 lines, no missing-file errors.

- [ ] **Step 3: TS + build sanity**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
```

Expected: TypeScript clean, "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add components/ui package.json package-lock.json components.json
git commit -m "chore: shadcn dialog/dropdown/alert-dialog/avatar/badge/separator"
```

---

## Task 2: Validation schemas

**Files:** create `lib/validation.ts`

- [ ] **Step 1: Write zod schemas**

```ts
// lib/validation.ts
import { z } from "zod";

export const Title = z.string().trim().min(1, "Required").max(120);
export const Email = z.string().trim().email().max(254);
export const Uuid  = z.string().uuid();

export const CreateWorkspaceInput = z.object({ name: Title });
export const RenameWorkspaceInput = z.object({ id: Uuid, name: Title });
export const DeleteWorkspaceInput = z.object({ id: Uuid });

export const InviteMemberInput   = z.object({
  workspaceId: Uuid,
  email: Email,
  role: z.enum(["admin", "member"]),
});
export const ChangeMemberRoleInput = z.object({
  workspaceId: Uuid,
  userId: Uuid,
  role: z.enum(["owner", "admin", "member"]),
});
export const RemoveMemberInput = z.object({ workspaceId: Uuid, userId: Uuid });

export const CreateBoardInput = z.object({
  workspaceId: Uuid,
  title: Title,
  backgroundKind: z.enum(["color", "image"]).default("color"),
  backgroundValue: z.string().min(1).default("#0079bf"),
});
export const RenameBoardInput      = z.object({ id: Uuid, title: Title });
export const SetBoardArchivedInput = z.object({ id: Uuid, archived: z.boolean() });
export const DeleteBoardInput      = z.object({ id: Uuid });
```

- [ ] **Step 2: Commit**

```bash
git add lib/validation.ts
git commit -m "feat: zod input schemas for workspace + board actions"
```

---

## Task 3: Read helpers

**Files:** create `lib/queries/workspaces.ts`, `lib/queries/boards.ts`

- [ ] **Step 1: workspaces.ts**

```ts
// lib/queries/workspaces.ts
import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  workspaces, workspaceMembers, boards, profiles,
} from "@/lib/db/schema";

export async function listWorkspaces(token: string) {
  return dbAsUser(token, async (tx) =>
    tx.select({
        id: workspaces.id,
        name: workspaces.name,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .orderBy(desc(workspaces.createdAt)),
  );
}

export async function getWorkspace(token: string, id: string) {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, id));
    return row ?? null;
  });
}

export async function listMembers(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
      })
      .from(workspaceMembers)
      .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
  );
}

export async function listBoardsInWorkspace(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select({
        id: boards.id,
        title: boards.title,
        backgroundKind: boards.backgroundKind,
        backgroundValue: boards.backgroundValue,
        archived: boards.archived,
        createdAt: boards.createdAt,
      })
      .from(boards)
      .where(eq(boards.workspaceId, workspaceId))
      .orderBy(desc(boards.createdAt)),
  );
}
```

- [ ] **Step 2: boards.ts**

```ts
// lib/queries/boards.ts
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards } from "@/lib/db/schema";

export async function getBoard(token: string, id: string) {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select().from(boards).where(eq(boards.id, id));
    return row ?? null;
  });
}
```

- [ ] **Step 3: TS check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/queries
git commit -m "feat: workspace + board read helpers (RLS-enforced via dbAsUser)"
```

---

## Task 4: Workspace Server Actions (TDD)

**Files:** create `actions/workspaces.ts`, `tests/integration/actions/workspaces.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/integration/actions/workspaces.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces, workspaceMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token, email };
}

// Avoid Next.js cookies() inside actions tests by importing the inner
// helpers, not the server actions themselves. We test the SQL effect
// via dbAsUser. Server-action wrappers are tested via E2E.
import { createWorkspaceImpl, deleteWorkspaceImpl } from "@/actions/workspaces";

describe("workspace actions (impl)", () => {
  it("createWorkspaceImpl creates a workspace owned by the caller", async () => {
    const u = await makeUser("ws-create");
    const ws = await createWorkspaceImpl(u.jwt, { name: "Project X" });
    expect(ws.name).toBe("Project X");
    expect(ws.ownerId).toBe(u.id);

    const m = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, ws.id),
            eq(workspaceMembers.userId, u.id))
      ),
    );
    expect(m[0].role).toBe("owner");
  });

  it("deleteWorkspaceImpl removes the workspace for owner", async () => {
    const u = await makeUser("ws-del");
    const ws = await createWorkspaceImpl(u.jwt, { name: "ToDelete" });
    await deleteWorkspaceImpl(u.jwt, { id: ws.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(workspaces).where(eq(workspaces.id, ws.id))
    );
    expect(after.length).toBe(0);
  });

  it("non-owner cannot delete workspace", async () => {
    const owner = await makeUser("ws-owner");
    const other = await makeUser("ws-other");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Locked" });
    await expect(deleteWorkspaceImpl(other.jwt, { id: ws.id })).rejects.toThrow();
    // owner can still see it
    const stillThere = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaces).where(eq(workspaces.id, ws.id))
    );
    expect(stillThere.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, see fail**

```bash
npx vitest run tests/integration/actions/workspaces.test.ts
```

Expected: FAIL — module `@/actions/workspaces` not found.

- [ ] **Step 3: Implement actions + impl helpers**

```ts
// actions/workspaces.ts
"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaces, workspaceMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateWorkspaceInput, DeleteWorkspaceInput, RenameWorkspaceInput,
} from "@/lib/validation";

// Pure impls — accept token + parsed input. Tested directly.
export async function createWorkspaceImpl(
  token: string,
  input: { name: string },
) {
  const parsed = CreateWorkspaceInput.parse(input);
  const ownerId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [ws] = await tx.insert(workspaces)
      .values({ name: parsed.name, ownerId })
      .returning();
    await tx.insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: ownerId, role: "owner" });
    return ws;
  });
}

export async function renameWorkspaceImpl(
  token: string,
  input: { id: string; name: string },
) {
  const parsed = RenameWorkspaceInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [ws] = await tx.update(workspaces)
      .set({ name: parsed.name })
      .where(eq(workspaces.id, parsed.id))
      .returning();
    if (!ws) throw new Error("Forbidden");
    return ws;
  });
}

export async function deleteWorkspaceImpl(
  token: string,
  input: { id: string },
) {
  const parsed = DeleteWorkspaceInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const res = await tx.delete(workspaces)
      .where(eq(workspaces.id, parsed.id))
      .returning({ id: workspaces.id });
    if (res.length === 0) throw new Error("Forbidden");
  });
}

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return claims.sub as string;
}

// Server-action wrappers that resolve the JWT from cookies.
export async function createWorkspace(input: { name: string }) {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await createWorkspaceImpl(token, input);
  revalidatePath("/");
  return ws;
}

export async function renameWorkspace(input: { id: string; name: string }) {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await renameWorkspaceImpl(token, input);
  revalidatePath("/");
  revalidatePath(`/w/${ws.id}`);
  return ws;
}

export async function deleteWorkspace(input: { id: string }) {
  await requireUser();
  const token = (await getSessionToken())!;
  await deleteWorkspaceImpl(token, input);
  revalidatePath("/");
}
```

- [ ] **Step 4: Re-run test, confirm pass**

```bash
npx vitest run tests/integration/actions/workspaces.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add actions/workspaces.ts tests/integration/actions/workspaces.test.ts
git commit -m "feat(workspaces): create/rename/delete server actions + impls (RLS)"
```

---

## Task 5: Board Server Actions (TDD)

**Files:** create `actions/boards.ts`, `tests/integration/actions/boards.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/integration/actions/boards.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces, boards, boardMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import {
  createBoardImpl, renameBoardImpl, setBoardArchivedImpl, deleteBoardImpl,
} from "@/actions/boards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("board actions (impl)", () => {
  it("createBoardImpl creates a board + adds creator as admin", async () => {
    const u = await makeUser("brd-create");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Sprint 1",
      backgroundKind: "color", backgroundValue: "#0079bf",
    });
    expect(b.title).toBe("Sprint 1");
    expect(b.workspaceId).toBe(ws.id);

    const bm = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boardMembers)
        .where(and(eq(boardMembers.boardId, b.id), eq(boardMembers.userId, u.id)))
    );
    expect(bm[0].role).toBe("admin");
  });

  it("renameBoardImpl + setBoardArchivedImpl + deleteBoardImpl work for board admin", async () => {
    const u = await makeUser("brd-edit");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS2" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Old",
      backgroundKind: "color", backgroundValue: "#000",
    });
    const renamed = await renameBoardImpl(u.jwt, { id: b.id, title: "New" });
    expect(renamed.title).toBe("New");

    await setBoardArchivedImpl(u.jwt, { id: b.id, archived: true });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boards).where(eq(boards.id, b.id))
    );
    expect(row.archived).toBe(true);

    await deleteBoardImpl(u.jwt, { id: b.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boards).where(eq(boards.id, b.id))
    );
    expect(after.length).toBe(0);
  });

  it("non-member cannot create a board in another user's workspace", async () => {
    const owner = await makeUser("brd-owner");
    const other = await makeUser("brd-other");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Private" });
    await expect(createBoardImpl(other.jwt, {
      workspaceId: ws.id, title: "Sneaky",
      backgroundKind: "color", backgroundValue: "#fff",
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
npx vitest run tests/integration/actions/boards.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// actions/boards.ts
"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, boardMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateBoardInput, DeleteBoardInput, RenameBoardInput, SetBoardArchivedInput,
} from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createBoardImpl(
  token: string,
  input: { workspaceId: string; title: string;
           backgroundKind: "color" | "image"; backgroundValue: string },
) {
  const parsed = CreateBoardInput.parse(input);
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [b] = await tx.insert(boards).values({
      workspaceId: parsed.workspaceId,
      title: parsed.title,
      backgroundKind: parsed.backgroundKind,
      backgroundValue: parsed.backgroundValue,
      createdBy,
    }).returning();
    if (!b) throw new Error("Forbidden");
    await tx.insert(boardMembers).values({
      boardId: b.id, userId: createdBy, role: "admin",
    });
    return b;
  });
}

export async function renameBoardImpl(
  token: string,
  input: { id: string; title: string },
) {
  const parsed = RenameBoardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(boards)
      .set({ title: parsed.title })
      .where(eq(boards.id, parsed.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function setBoardArchivedImpl(
  token: string,
  input: { id: string; archived: boolean },
) {
  const parsed = SetBoardArchivedInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(boards)
      .set({ archived: parsed.archived })
      .where(eq(boards.id, parsed.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteBoardImpl(
  token: string,
  input: { id: string },
) {
  const parsed = DeleteBoardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(boards)
      .where(eq(boards.id, parsed.id))
      .returning({ id: boards.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

// Server action wrappers
export async function createBoard(input: Parameters<typeof createBoardImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await createBoardImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}`);
  return b;
}
export async function renameBoard(input: Parameters<typeof renameBoardImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await renameBoardImpl(token, input);
  revalidatePath(`/b/${b.id}`);
  return b;
}
export async function setBoardArchived(input: Parameters<typeof setBoardArchivedImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await setBoardArchivedImpl(token, input);
  revalidatePath(`/w/${b.workspaceId}`);
  return b;
}
export async function deleteBoard(input: Parameters<typeof deleteBoardImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  await deleteBoardImpl(token, input);
}
```

- [ ] **Step 4: Re-run, confirm pass**

```bash
npx vitest run tests/integration/actions/boards.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add actions/boards.ts tests/integration/actions/boards.test.ts
git commit -m "feat(boards): create/rename/archive/delete server actions + impls"
```

---

## Task 6: Workspace member actions (TDD)

**Files:** create `actions/workspace-members.ts`, `tests/integration/actions/workspace-members.test.ts`

The `inviteMember` action looks up a user by email (via `service` client because anon can't list auth.users). To stay aligned with the security model (RLS does the gate, not app code), we look up the user via the `profiles` table where the email is stored as `display_name` placeholder OR via a SECURITY DEFINER `find_user_by_email` helper. Use the helper.

- [ ] **Step 1: Add SQL helper migration**

```sql
-- supabase/migrations/0004_find_user_helper.sql
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.find_user_id_by_email(text) from public;
grant execute on function public.find_user_id_by_email(text) to authenticated;
```

Apply: `supabase db reset` (re-runs all 4 migrations).

- [ ] **Step 2: Failing test**

```ts
// tests/integration/actions/workspace-members.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import {
  inviteMemberImpl, changeMemberRoleImpl, removeMemberImpl,
} from "@/actions/workspace-members";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token, email };
}

describe("workspace member actions (impl)", () => {
  it("invite + change role + remove", async () => {
    const owner = await makeUser("wm-own");
    const guest = await makeUser("wm-guest");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Team" });

    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id, email: guest.email, role: "member",
    });
    let rows = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, guest.id),
      ))
    );
    expect(rows[0].role).toBe("member");

    await changeMemberRoleImpl(owner.jwt, {
      workspaceId: ws.id, userId: guest.id, role: "admin",
    });
    rows = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, guest.id),
      ))
    );
    expect(rows[0].role).toBe("admin");

    await removeMemberImpl(owner.jwt, { workspaceId: ws.id, userId: guest.id });
    rows = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, guest.id),
      ))
    );
    expect(rows.length).toBe(0);
  });

  it("non-admin cannot invite", async () => {
    const owner = await makeUser("wm-own2");
    const guest = await makeUser("wm-guest2");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Locked" });
    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id, email: guest.email, role: "member",
    });
    const stranger = await makeUser("wm-strg");
    await expect(inviteMemberImpl(guest.jwt, {
      workspaceId: ws.id, email: stranger.email, role: "member",
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run, see fail**

```bash
npx vitest run tests/integration/actions/workspace-members.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// actions/workspace-members.ts
"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  InviteMemberInput, ChangeMemberRoleInput, RemoveMemberInput,
} from "@/lib/validation";

export async function inviteMemberImpl(
  token: string,
  input: { workspaceId: string; email: string; role: "admin" | "member" },
) {
  const parsed = InviteMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${parsed.email}) as id`,
    );
    const userId = (lookup as unknown as { id: string | null }[])[0]?.id;
    if (!userId) throw new Error("No user with that email");

    const [row] = await tx.insert(workspaceMembers)
      .values({ workspaceId: parsed.workspaceId, userId, role: parsed.role })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      // Either RLS denied or row already existed. Distinguish by re-querying.
      const existing = await tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, userId),
      ));
      if (existing.length === 0) throw new Error("Forbidden");
      return existing[0];
    }
    return row;
  });
}

export async function changeMemberRoleImpl(
  token: string,
  input: { workspaceId: string; userId: string; role: "owner" | "admin" | "member" },
) {
  const parsed = ChangeMemberRoleInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(workspaceMembers)
      .set({ role: parsed.role })
      .where(and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, parsed.userId),
      ))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function removeMemberImpl(
  token: string,
  input: { workspaceId: string; userId: string },
) {
  const parsed = RemoveMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, parsed.workspaceId),
      eq(workspaceMembers.userId, parsed.userId),
    )).returning({ userId: workspaceMembers.userId });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

// Server-action wrappers
export async function inviteMember(input: Parameters<typeof inviteMemberImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await inviteMemberImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}/settings`);
  return r;
}
export async function changeMemberRole(input: Parameters<typeof changeMemberRoleImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await changeMemberRoleImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}/settings`);
  return r;
}
export async function removeMember(input: Parameters<typeof removeMemberImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  await removeMemberImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}/settings`);
}
```

- [ ] **Step 5: Re-run, confirm pass**

```bash
npx vitest run tests/integration/actions/workspace-members.test.ts
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0004_find_user_helper.sql \
        actions/workspace-members.ts \
        tests/integration/actions/workspace-members.test.ts
git commit -m "feat(members): invite/changeRole/remove + find_user_id_by_email helper"
```

---

## Task 7: Workspace switcher in top nav

**Files:** modify `app/(app)/layout.tsx`, `components/nav/top-nav.tsx`; create `components/workspace/workspace-switcher.tsx`, `components/workspace/create-workspace-dialog.tsx`

- [ ] **Step 1: Workspace switcher component**

```tsx
// components/workspace/workspace-switcher.tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import { useState } from "react";

export type WorkspaceLite = { id: string; name: string };

export function WorkspaceSwitcher({
  workspaces, activeId,
}: { workspaces: WorkspaceLite[]; activeId?: string }) {
  const [openCreate, setOpenCreate] = useState(false);
  const active = workspaces.find(w => w.id === activeId) ?? workspaces[0];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1">
            {active?.name ?? "Workspaces"} <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map(w => (
            <DropdownMenuItem key={w.id} asChild>
              <Link href={`/w/${w.id}`}>{w.name}</Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpenCreate(true); }}>
            <Plus className="size-4 mr-2" /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={openCreate} onOpenChange={setOpenCreate} />
    </>
  );
}
```

- [ ] **Step 2: Create-workspace dialog**

```tsx
// components/workspace/create-workspace-dialog.tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createWorkspace } from "@/actions/workspaces";

export function CreateWorkspaceDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const ws = await createWorkspace({ name });
        onOpenChange(false);
        setName("");
        router.push(`/w/${ws.id}`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" value={name}
                   onChange={(e) => setName(e.target.value)}
                   placeholder="Acme team" required minLength={1} maxLength={120} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update top nav**

```tsx
// components/nav/top-nav.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";
import { WorkspaceSwitcher, type WorkspaceLite } from "@/components/workspace/workspace-switcher";

export function TopNav({
  email, workspaces, activeWorkspaceId,
}: {
  email: string;
  workspaces: WorkspaceLite[];
  activeWorkspaceId?: string;
}) {
  return (
    <header className="border-b">
      <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/" className="font-semibold">Trello Clone</Link>
          <span className="text-muted-foreground">/</span>
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>
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

- [ ] **Step 4: Update app layout to fetch workspaces + active id**

```tsx
// app/(app)/layout.tsx
import { headers } from "next/headers";
import { requireUser, getSessionToken } from "@/lib/auth";
import { TopNav } from "@/components/nav/top-nav";
import { listWorkspaces } from "@/lib/queries/workspaces";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);

  // Derive active workspace from current URL header (set by middleware).
  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  const m = path.match(/^\/w\/([0-9a-f-]{36})/);
  const activeWorkspaceId = m ? m[1] : undefined;

  return (
    <>
      <TopNav
        email={user.email ?? ""}
        workspaces={ws.map(w => ({ id: w.id, name: w.name }))}
        activeWorkspaceId={activeWorkspaceId}
      />
      <div className="max-w-6xl mx-auto p-6">{children}</div>
    </>
  );
}
```

- [ ] **Step 5: Set `x-pathname` header in middleware**

Modify `lib/supabase/middleware.ts` to add the request pathname to the response headers (so the layout can read it). Add this just before the `await supa.auth.getUser()` call:

```ts
res.headers.set("x-pathname", req.nextUrl.pathname);
```

(Actually, `req.headers` is more correct because the layout reads request headers, not response. The pattern is:
```ts
const requestHeaders = new Headers(req.headers);
requestHeaders.set("x-pathname", req.nextUrl.pathname);
const res = NextResponse.next({ request: { headers: requestHeaders } });
```
Replace the existing `const res = NextResponse.next(...)` line with the 3 lines above.)

- [ ] **Step 6: Sanity check + commit**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
git add app/\(app\)/layout.tsx components/nav components/workspace lib/supabase/middleware.ts
git commit -m "feat(nav): workspace switcher + create-workspace dialog + active-ws via x-pathname"
```

---

## Task 8: Workspace home + board grid + create-board dialog

**Files:** modify `app/(app)/page.tsx`, create `app/(app)/w/[workspaceId]/page.tsx`, `components/workspace/board-grid.tsx`, `components/workspace/create-board-dialog.tsx`

- [ ] **Step 1: Root `/` redirects to most-recent workspace**

```tsx
// app/(app)/page.tsx
import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);
  if (ws.length === 0) {
    return (
      <main className="space-y-4">
        <h1 className="text-2xl font-semibold">No workspaces yet</h1>
        <p className="text-sm text-muted-foreground">
          Use the workspace switcher in the top nav to create one.
        </p>
      </main>
    );
  }
  redirect(`/w/${ws[0].id}`);
}
```

- [ ] **Step 2: Workspace page — board grid + new board button**

```tsx
// app/(app)/w/[workspaceId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listBoardsInWorkspace } from "@/lib/queries/workspaces";
import { BoardGrid } from "@/components/workspace/board-grid";
import { CreateBoardButton } from "@/components/workspace/create-board-dialog";
import { Button } from "@/components/ui/button";

export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const boards = await listBoardsInWorkspace(token, workspaceId);

  return (
    <main className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{ws.name}</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/w/${workspaceId}/settings`}>Settings</Link>
          </Button>
          <CreateBoardButton workspaceId={workspaceId} />
        </div>
      </div>
      <BoardGrid boards={boards} />
    </main>
  );
}
```

- [ ] **Step 3: BoardGrid**

```tsx
// components/workspace/board-grid.tsx
import Link from "next/link";

export type BoardTile = {
  id: string; title: string;
  backgroundKind: string; backgroundValue: string;
  archived: boolean;
};

export function BoardGrid({ boards }: { boards: BoardTile[] }) {
  if (boards.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No boards yet. Create one with the button above.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {boards.filter(b => !b.archived).map(b => (
        <li key={b.id}>
          <Link
            href={`/b/${b.id}`}
            className="block aspect-[3/2] rounded-md p-3 text-white font-medium shadow-sm hover:opacity-90 transition"
            style={{ background: b.backgroundKind === "color" ? b.backgroundValue : undefined }}
          >
            {b.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: CreateBoardButton (button + dialog)**

```tsx
// components/workspace/create-board-dialog.tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createBoard } from "@/actions/boards";
import { Plus } from "lucide-react";

const PALETTE = ["#0079bf", "#d29034", "#519839", "#b04632", "#89609e", "#cd5a91"];

export function CreateBoardButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [pending, start] = useTransition();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const b = await createBoard({
          workspaceId, title,
          backgroundKind: "color", backgroundValue: color,
        });
        setOpen(false); setTitle("");
        router.push(`/b/${b.id}`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4 mr-1" /> New board
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create board</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="board-title">Title</Label>
              <Input id="board-title" value={title}
                     onChange={(e) => setTitle(e.target.value)}
                     required minLength={1} maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label>Background</Label>
              <div className="flex gap-2">
                {PALETTE.map(c => (
                  <button key={c} type="button"
                    onClick={() => setColor(c)}
                    className={`size-8 rounded ${color === c ? "ring-2 ring-foreground" : ""}`}
                    style={{ background: c }}
                    aria-label={`Pick ${c}`} />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? "Creating…" : "Create board"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 5: Smoke + commit**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
git add app/\(app\)/page.tsx app/\(app\)/w components/workspace/board-grid.tsx components/workspace/create-board-dialog.tsx
git commit -m "feat(workspace): home redirect + per-workspace page + board grid + create-board"
```

---

## Task 9: Board view stub page

**Files:** create `app/(app)/b/[boardId]/page.tsx`

- [ ] **Step 1: Page**

```tsx
// app/(app)/b/[boardId]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoard } from "@/lib/queries/boards";
import { Button } from "@/components/ui/button";

export default async function BoardPage({
  params,
}: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await getBoard(token, boardId);
  if (!b) notFound();

  const bg = b.backgroundKind === "color" ? b.backgroundValue : "#0079bf";
  return (
    <main
      className="-m-6 min-h-[calc(100vh-3rem)] p-6 text-white"
      style={{ background: bg }}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/b/${boardId}/settings`}>Board settings</Link>
        </Button>
      </div>
      <p className="mt-8 opacity-80 text-sm">
        Lists and cards land in plan #3.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(app\)/b
git commit -m "feat(board): board view stub (title + bg + lists placeholder)"
```

---

## Task 10: Workspace settings (rename, members, danger zone)

**Files:** create `app/(app)/w/[workspaceId]/settings/page.tsx`, `components/workspace/member-list.tsx`, `components/workspace/invite-member-form.tsx`, `components/workspace/workspace-settings-form.tsx`

- [ ] **Step 1: Settings page (server)**

```tsx
// app/(app)/w/[workspaceId]/settings/page.tsx
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listMembers } from "@/lib/queries/workspaces";
import { WorkspaceSettingsForm } from "@/components/workspace/workspace-settings-form";
import { MemberList } from "@/components/workspace/member-list";
import { InviteMemberForm } from "@/components/workspace/invite-member-form";
import { Separator } from "@/components/ui/separator";

export default async function WorkspaceSettingsPage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const members = await listMembers(token, workspaceId);

  return (
    <main className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">{ws.name} — Settings</h1>

      <section className="space-y-4">
        <h2 className="font-medium">Workspace</h2>
        <WorkspaceSettingsForm workspace={{ id: ws.id, name: ws.name }} />
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="font-medium">Members</h2>
        <InviteMemberForm workspaceId={workspaceId} />
        <MemberList workspaceId={workspaceId} members={members} />
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Settings form (rename + delete)**

```tsx
// components/workspace/workspace-settings-form.tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { renameWorkspace, deleteWorkspace } from "@/actions/workspaces";
import { toast } from "sonner";

export function WorkspaceSettingsForm({
  workspace,
}: { workspace: { id: string; name: string } }) {
  const [name, setName] = useState(workspace.name);
  const [pending, start] = useTransition();
  const router = useRouter();

  function rename(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try { await renameWorkspace({ id: workspace.id, name }); toast.success("Renamed"); }
      catch (err) { toast.error((err as Error).message); }
    });
  }
  function remove() {
    start(async () => {
      try { await deleteWorkspace({ id: workspace.id }); router.push("/"); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={rename} className="space-y-2">
        <Label htmlFor="ws-rename">Name</Label>
        <div className="flex gap-2">
          <Input id="ws-rename" value={name} onChange={(e) => setName(e.target.value)}
                 required minLength={1} maxLength={120} className="max-w-xs" />
          <Button type="submit" disabled={pending || name === workspace.name}>Save</Button>
        </div>
      </form>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm">Delete workspace</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              All boards, lists, and cards in this workspace will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Invite member form**

```tsx
// components/workspace/invite-member-form.tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { inviteMember } from "@/actions/workspace-members";
import { toast } from "sonner";

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await inviteMember({ workspaceId, email, role });
        setEmail("");
        toast.success("Invited");
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="space-y-1.5 flex-1">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" type="email" value={email}
               onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline">Role: {role}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
            <DropdownMenuRadioItem value="member">Member</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="submit" disabled={pending || !email}>Invite</Button>
    </form>
  );
}
```

- [ ] **Step 4: Member list**

```tsx
// components/workspace/member-list.tsx
"use client";
import { useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { changeMemberRole, removeMember } from "@/actions/workspace-members";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

type Member = {
  userId: string; role: "owner" | "admin" | "member";
  displayName: string; avatarUrl: string | null;
};

export function MemberList({
  workspaceId, members,
}: { workspaceId: string; members: Member[] }) {
  const [pending, start] = useTransition();

  return (
    <ul className="divide-y rounded border">
      {members.map(m => (
        <li key={m.userId} className="flex items-center gap-3 p-3">
          <Avatar className="size-8">
            <AvatarImage src={m.avatarUrl ?? undefined} />
            <AvatarFallback>{m.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="flex-1">{m.displayName}</span>
          <Badge variant="outline">{m.role}</Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={m.role === "owner"}>Change</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup value={m.role}
                onValueChange={(v) => {
                  start(async () => {
                    try {
                      await changeMemberRole({ workspaceId, userId: m.userId,
                        role: v as Member["role"] });
                    } catch (err) { toast.error((err as Error).message); }
                  });
                }}>
                <DropdownMenuRadioItem value="member">Member</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="destructive" disabled={m.role === "owner" || pending}
            onClick={() => start(async () => {
              try { await removeMember({ workspaceId, userId: m.userId }); }
              catch (err) { toast.error((err as Error).message); }
            })}>
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: TS check + commit**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
git add app/\(app\)/w/\[workspaceId\]/settings components/workspace
git commit -m "feat(workspace): settings page (rename, members, delete)"
```

---

## Task 11: Board settings page (rename, archive, delete)

**Files:** create `app/(app)/b/[boardId]/settings/page.tsx`, `components/board/board-settings-form.tsx`

- [ ] **Step 1: Server page**

```tsx
// app/(app)/b/[boardId]/settings/page.tsx
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoard } from "@/lib/queries/boards";
import { BoardSettingsForm } from "@/components/board/board-settings-form";

export default async function BoardSettingsPage({
  params,
}: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await getBoard(token, boardId);
  if (!b) notFound();
  return (
    <main className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{b.title} — Board settings</h1>
      <BoardSettingsForm
        board={{ id: b.id, title: b.title, archived: b.archived,
                 workspaceId: b.workspaceId }} />
    </main>
  );
}
```

- [ ] **Step 2: Form**

```tsx
// components/board/board-settings-form.tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { renameBoard, setBoardArchived, deleteBoard } from "@/actions/boards";
import { toast } from "sonner";

export function BoardSettingsForm({
  board,
}: { board: { id: string; title: string; archived: boolean; workspaceId: string } }) {
  const [title, setTitle] = useState(board.title);
  const [pending, start] = useTransition();
  const router = useRouter();

  function rename(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try { await renameBoard({ id: board.id, title }); toast.success("Renamed"); }
      catch (err) { toast.error((err as Error).message); }
    });
  }
  function toggleArchive() {
    start(async () => {
      try {
        await setBoardArchived({ id: board.id, archived: !board.archived });
        router.refresh();
      } catch (err) { toast.error((err as Error).message); }
    });
  }
  function remove() {
    start(async () => {
      try {
        await deleteBoard({ id: board.id });
        router.push(`/w/${board.workspaceId}`);
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={rename} className="space-y-2">
        <Label htmlFor="board-rename">Title</Label>
        <div className="flex gap-2">
          <Input id="board-rename" value={title}
                 onChange={(e) => setTitle(e.target.value)}
                 required minLength={1} maxLength={120} className="max-w-xs" />
          <Button type="submit" disabled={pending || title === board.title}>Save</Button>
        </div>
      </form>
      <Button variant="outline" onClick={toggleArchive} disabled={pending}>
        {board.archived ? "Restore from archive" : "Archive board"}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm">Delete board</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this board?</AlertDialogTitle>
            <AlertDialogDescription>
              The board and all its lists/cards will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: TS + commit**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
git add app/\(app\)/b/\[boardId\]/settings components/board
git commit -m "feat(board): settings page (rename, archive toggle, delete)"
```

---

## Task 12: E2E — workspace + board lifecycle

**Files:** create `tests/e2e/workspaces-boards.spec.ts`

- [ ] **Step 1: Test**

```ts
// tests/e2e/workspaces-boards.spec.ts
import { test, expect, request as pwRequest } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

async function fetchConfirmLink(email: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL: MAILPIT });
  for (let i = 0; i < 30; i++) {
    const list = await api.get(
      `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    );
    if (list.ok()) {
      const data = await list.json();
      if (data.messages && data.messages.length > 0) {
        const id = data.messages[0].ID;
        const detail = await api.get(`/api/v1/message/${id}`);
        const msg = await detail.json();
        const body: string = msg.HTML || msg.Text || "";
        const m =
          body.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/) ??
          body.match(/(https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+)/);
        if (m) return m[1].replace(/&amp;/g, "&");
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email arrived for ${email}`);
}

async function signupAndLogin(page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  const link = await fetchConfirmLink(email);
  await page.goto(link);
}

test("create workspace → create board → board view → archive", async ({ page }) => {
  const email = `wb-${Date.now()}@example.com`;
  await signupAndLogin(page, email);

  // Lands on /w/<default-workspace-id>
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);

  // Open workspace switcher → New workspace
  await page.getByRole("button", { name: /workspace/i }).first().click();
  await page.getByRole("menuitem", { name: /new workspace/i }).click();
  await page.getByLabel("Name").fill("Side Project");
  await page.getByRole("button", { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Side Project" })).toBeVisible();

  // Create board
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByLabel("Title").fill("Roadmap");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Roadmap" })).toBeVisible();

  // Board settings → archive → back to workspace, board hidden
  await page.getByRole("link", { name: /board settings/i }).click();
  await page.getByRole("button", { name: /archive board/i }).click();
  await page.goBack();
  await page.getByRole("link", { name: "Trello Clone" }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/);
  await expect(page.getByText("Roadmap")).toHaveCount(0);
});
```

- [ ] **Step 2: Run E2E**

```bash
npx playwright test
```

Expected: 2 passed (T18 auth test + this new one).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/workspaces-boards.spec.ts
git commit -m "test(e2e): workspace + board lifecycle"
```

---

## Task 13: Wire all integration tests + final smoke

**Files:** none new — verification only

- [ ] **Step 1: Run everything**

```bash
npm run test:unit
npm run test:e2e
```

Expected: all integration tests pass (8+ tests now), both E2E pass.

- [ ] **Step 2: Build clean**

```bash
npm run build 2>&1 | tail -3
```

Expected: "Compiled successfully".

- [ ] **Step 3: Manual smoke (optional but recommended)**

```bash
npm run dev &
sleep 5
# Hit a few URLs:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login
kill %1
```

Both should return 307 (unauth → /login) and 200 respectively.

---

## Self-Review Notes

- **Spec coverage:** This plan implements §3 (Server Actions on the boundary, RLS for security), §4.1 partial (workspaces, workspace_members, boards, board_members CRUD), §7 (auth helpers reused), §8 (file structure aligns: actions/*, lib/queries/*, components/workspace/, components/board/).
- **Out of scope verified:** No lists/cards code, no realtime, no card features, no activity log writes, no search.
- **Plan #1 hardening reused:** All actions go through `dbAsUser`; `db` is module-private; `getSessionToken` verifies via `getUser()` first.
- **Type consistency:** `createBoardImpl` signature matches what `createBoard` action and `CreateBoardButton` send. `workspace.id` / `board.id` are uuid strings throughout.
- **Known plan-author hazards (read this before implementing):**
  - Task 7 Step 5 changes `lib/supabase/middleware.ts` to set `x-pathname`. The `headers()` API in Next.js 15 reads request headers including any added by middleware via `NextResponse.next({ request: { headers: requestHeaders } })`. This is the supported pattern; verify by checking the Next.js docs if it doesn't work.
  - Task 6 uses `find_user_id_by_email(text)` SECURITY DEFINER. The function runs as `postgres`, so it bypasses RLS — that is the intent (we need to look up users by email even if they're not in any workspace). The RLS gate is on the INSERT into `workspace_members` itself (only admins of that workspace can insert).
  - Task 10's MemberList uses optimistic-style `start(async () => { ... })` without rollback. If the server denies, the toast surfaces the error and the page re-renders with stale data. Acceptable for plan #2; plan #4 (realtime) will tighten this.
  - The Board view (Task 9) sets a full-bleed colored background using a negative margin (`-m-6`). This works because the parent `(app)/layout.tsx` adds `p-6`. If that padding ever changes, the negative margin breaks visually — leave a TODO comment if you prefer, but it ships clean.
