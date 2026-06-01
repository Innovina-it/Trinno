# Link Entity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `link` entity (one URL per card as a coloured diamond, one URL per workspace as a cloud icon) readable by every workspace member and writable only by owner/admin.

**Architecture:** A new polymorphic `links` table (scope `workspace|card`) with RLS (read = any member incl. guest, write = owner/admin) and realtime CDC. A thin actions module, a shared `LinkIcon` + `LinkEditDialog`, a `useLongPress` hook (short click = open URL, ~500ms hold = edit), and integration into quick view, extended edit, card tile, gantt, roadmap list, and the workspace switcher.

**Tech Stack:** Next.js App Router (server actions), Drizzle ORM, Supabase Postgres + RLS + realtime, Zustand (`board-store`), Vitest (unit), Playwright (e2e), Tailwind, lucide-react icons, `@base-ui` dialog wrappers in `components/ui/*`.

**Spec:** `docs/superpowers/specs/2026-06-02-link-entity-design.md`

**Project conventions (read before starting):**
- Package manager is **npm** (use `npm`/`npx`, not pnpm).
- Apply migrations with **`npx supabase migration up`** — NEVER `db:reset` (wipes local data/auth).
- Server actions follow the pattern in `actions/card-links.ts`: `requireUser()` → `getSessionToken()` → `dbAsUser(token, tx => …)` → guard → mutate → `revalidatePath`, wrapped in `actionResult`.
- Vitest cannot transform `@base-ui/react`; any component importing `@/components/ui/*` fails unit import-analysis. Keep pure logic in hooks/utils (unit-tested) and test dialog/icon wiring via Playwright.
- Existing `card_links` table = card-to-card relations. This feature's table is `links` and store slice is `cardLinkByCard` — do **not** touch `cardLinks`.

---

## File Structure

**New files**
- `supabase/migrations/0121_links.sql` — table, enum, trigger, RLS, realtime publication
- `lib/links/colors.ts` — diamond colour palette + default
- `lib/links/normalize-url.ts` — URL normalisation helper (pure)
- `lib/hooks/use-long-press.ts` — click-vs-hold pointer hook (pure-ish)
- `lib/permissions/workspace-writer.ts` — `assertWorkspaceWriter`
- `actions/links.ts` — upsert/remove for card + workspace links
- `components/links/link-icon.tsx` — chain / diamond / cloud renderer
- `components/links/link-edit-dialog.tsx` — 3-line URL textarea + colour picker + remove + Close→Save
- `components/links/links-realtime.tsx` — CDC subscriber → `router.refresh()`
- `lib/links/types.ts` — shared `CardUrlLink` / `WorkspaceLink` types
- Tests: `lib/links/__tests__/normalize-url.test.ts`, `lib/links/__tests__/colors.test.ts`, `lib/hooks/__tests__/use-long-press.test.ts`, `lib/permissions/__tests__/workspace-writer.test.ts`, `tests/e2e/links.spec.ts`

**Modified files**
- `lib/db/schema.ts` — add `linkScope` enum + `links` table
- `lib/validation.ts` — add `UpsertCardLinkInput`, `UpsertWorkspaceLinkInput`
- `stores/board-store.ts` — add `cardLinkByCard` slice + setters + seed
- `components/board/card-quick-view.tsx` — chain/diamond + dialog
- `components/board/card/attachments-section.tsx` (or sibling `link-section.tsx`) — link control next to attachments
- `components/board/card-modal.tsx` — render the link section
- `components/board/card-tile.tsx` — diamond at end of title
- `components/roadmap/roadmap-bar.tsx` — diamond between bar and assignees
- `components/roadmap/roadmap-list-view.tsx` — diamond at end of title
- `components/workspace/workspace-switcher.tsx` — cloud icon beside active name
- `components/workspace/workspace-settings-form.tsx` — create/edit/remove workspace link
- `components/nav/top-nav.tsx` — pass active workspace link + role to switcher
- Board SSR loader + workspace layout — seed `cardLinkByCard`, mount `LinksRealtime`, pass workspace link

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0121_links.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 2026-06-02 — Link entity. One URL per card (coloured diamond) and one
-- URL per workspace (cloud icon). Read = any workspace member incl. guest.
-- Write = owner/admin only (RLS + a TS guard at the action layer).
-- Distinct from card_links (card-to-card relations).

create type public.link_scope as enum ('workspace','card');

create table public.links (
  id           uuid primary key default gen_random_uuid(),
  scope        public.link_scope not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  card_id      uuid references public.cards(id) on delete cascade,
  url          text not null,
  color        text,                       -- card scope only; null for workspace
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint links_scope_shape check (
    (scope = 'workspace' and card_id is null and color is null) or
    (scope = 'card'      and card_id is not null)
  )
);

-- 1:1 per owner
create unique index links_ws_ux   on public.links(workspace_id) where scope = 'workspace';
create unique index links_card_ux on public.links(card_id)      where scope = 'card';
create index links_workspace_idx  on public.links(workspace_id);

-- Resolve + denormalise workspace_id for card-scope links from the card's
-- board, and keep updated_at fresh. Mirrors the card_links board_id trigger.
create or replace function public.links_set_workspace_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.scope = 'card' then
    select b.workspace_id into new.workspace_id
      from public.cards c
      join public.boards b on b.id = c.board_id
      where c.id = new.card_id;
    if new.workspace_id is null then
      raise exception 'links: cannot resolve workspace for card %', new.card_id;
    end if;
  end if;
  return new;
end$$;

drop trigger if exists links_set_workspace_id_biu on public.links;
create trigger links_set_workspace_id_biu
  before insert or update on public.links
  for each row execute function public.links_set_workspace_id();

-- RLS
alter table public.links enable row level security;

create policy links_select on public.links for select using (
  workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()
  )
);

create policy links_write on public.links for all using (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = links.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
) with check (
  exists (
    select 1 from public.workspace_members m
    where m.workspace_id = links.workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- Realtime: emit full row on delete + add to publication (idempotent).
alter table public.links replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'links'
  ) then
    alter publication supabase_realtime add table public.links;
  end if;
end$$;
```

> Note on the write policy `using` clause: `workspace_id` is trigger-set on INSERT, so the
> INSERT gate relies on `with check`. Because the trigger runs `before insert`, `with check`
> sees the resolved `workspace_id`. For card inserts the actor must already be owner/admin of
> the resolved workspace — enforced again in the action guard (Task 4).

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up`
Expected: applies `0121_links` with no error. (Do NOT use db:reset.)

- [ ] **Step 3: Verify schema + RLS exist**

Run:
```bash
npx supabase db execute --query "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='links';"
npx supabase db execute --query "select polname from pg_policies where tablename='links';"
```
Expected: one publication row `links`; policies `links_select` and `links_write` listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0121_links.sql
git commit -m "feat(links): add links table, trigger, RLS and realtime (0121)"
```

---

## Task 2: Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add the enum + table**

Locate the `cardLinks` table definition (the `card_links` relations table) and add the new
`links` table near it. Add at the end of the enum declarations:

```ts
export const linkScope = pgEnum("link_scope", ["workspace", "card"]);
```

Add the table (place after `cardLinks`):

```ts
export const links = pgTable("links", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: linkScope("scope").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  cardId: uuid("card_id"),
  url: text("url").notNull(),
  color: text("color"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LinkRow = typeof links.$inferSelect;
```

(If `pgEnum`/`text`/`uuid`/`timestamp` are not already imported, they are — `cardLinks` uses
them. Confirm `pgEnum` is imported; other enums in this file use it.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `links`/`linkScope`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts
git commit -m "feat(links): drizzle schema for links table"
```

---

## Task 3: URL normalisation + validation

**Files:**
- Create: `lib/links/normalize-url.ts`
- Create: `lib/links/__tests__/normalize-url.test.ts`
- Modify: `lib/validation.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/links/__tests__/normalize-url.test.ts
import { describe, it, expect } from "vitest";
import { normalizeUrl } from "@/lib/links/normalize-url";

describe("normalizeUrl", () => {
  it("prepends https:// when no scheme", () => {
    expect(normalizeUrl("drive.google.com/x")).toBe("https://drive.google.com/x");
  });
  it("keeps http/https as-is", () => {
    expect(normalizeUrl("http://a.test")).toBe("http://a.test");
    expect(normalizeUrl("https://a.test")).toBe("https://a.test");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  https://a.test  ")).toBe("https://a.test");
  });
  it("throws on empty", () => {
    expect(() => normalizeUrl("   ")).toThrow();
  });
  it("throws on unparseable", () => {
    expect(() => normalizeUrl("ht!tp://%%%")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/links/__tests__/normalize-url.test.ts`
Expected: FAIL — cannot find module `normalize-url`.

- [ ] **Step 3: Implement**

```ts
// lib/links/normalize-url.ts
// Normalises a user-entered link: trims, prepends https:// when no scheme,
// and validates it parses as an absolute http(s) URL.
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL is empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("URL is not valid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must be http or https");
  }
  return parsed.toString().replace(/\/$/, withScheme.endsWith("/") ? "/" : "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/links/__tests__/normalize-url.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add Zod input schemas**

In `lib/validation.ts`, after the `DeleteCardLinkInput` definition (~line 283), add:

```ts
// Link entity (URL links on cards/workspaces) — distinct from CardLink relations above.
export const LinkColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "color must be a #rrggbb hex");
export const UpsertCardLinkInput = z.object({
  cardId: Uuid,
  url: z.string().trim().min(1).max(2048),
  color: LinkColor,
});
export const UpsertWorkspaceLinkInput = z.object({
  workspaceId: Uuid,
  url: z.string().trim().min(1).max(2048),
});
export const RemoveCardLinkInput = z.object({ cardId: Uuid });
export const RemoveWorkspaceLinkInput = z.object({ workspaceId: Uuid });
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/links/normalize-url.ts lib/links/__tests__/normalize-url.test.ts lib/validation.ts
git commit -m "feat(links): url normalisation + validation schemas"
```

---

## Task 4: Permission guard `assertWorkspaceWriter`

**Files:**
- Create: `lib/permissions/workspace-writer.ts`
- Create: `lib/permissions/__tests__/workspace-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/permissions/__tests__/workspace-writer.test.ts
import { describe, it, expect } from "vitest";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { StructuredError } from "@/lib/errors";

describe("assertWorkspaceWriter", () => {
  it("allows owner and admin", () => {
    expect(() => assertWorkspaceWriter("owner")).not.toThrow();
    expect(() => assertWorkspaceWriter("admin")).not.toThrow();
  });
  it("rejects member, guest and null", () => {
    for (const r of ["member", "guest", null] as const) {
      expect(() => assertWorkspaceWriter(r)).toThrow(StructuredError);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/permissions/__tests__/workspace-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/permissions/workspace-writer.ts
// Link writes are owner/admin-only (member + guest are read-only).
import { StructuredError } from "@/lib/errors";
import type { WorkspaceRole } from "@/lib/permissions/guest-guard";

export function assertWorkspaceWriter(role: WorkspaceRole): void {
  if (role !== "owner" && role !== "admin") {
    throw new StructuredError("ACCESS_DENIED", "Forbidden", { role });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/permissions/__tests__/workspace-writer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/permissions/workspace-writer.ts lib/permissions/__tests__/workspace-writer.test.ts
git commit -m "feat(links): assertWorkspaceWriter owner/admin guard"
```

---

## Task 5: Colour palette + shared types

**Files:**
- Create: `lib/links/colors.ts`
- Create: `lib/links/types.ts`
- Create: `lib/links/__tests__/colors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/links/__tests__/colors.test.ts
import { describe, it, expect } from "vitest";
import { LINK_COLORS, DEFAULT_LINK_COLOR } from "@/lib/links/colors";

describe("link colors", () => {
  it("has the five fixed colours in order", () => {
    expect(LINK_COLORS.map((c) => c.key)).toEqual([
      "giallo", "arancione", "blu", "rosso", "verde",
    ]);
  });
  it("default is the first (giallo) hex", () => {
    expect(DEFAULT_LINK_COLOR).toBe(LINK_COLORS[0].hex);
    expect(DEFAULT_LINK_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/links/__tests__/colors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement colours + types**

```ts
// lib/links/colors.ts
export type LinkColorKey = "giallo" | "arancione" | "blu" | "rosso" | "verde";
export const LINK_COLORS: { key: LinkColorKey; label: string; hex: string }[] = [
  { key: "giallo",    label: "Giallo",    hex: "#facc15" },
  { key: "arancione", label: "Arancione", hex: "#fb923c" },
  { key: "blu",       label: "Blu",       hex: "#3b82f6" },
  { key: "rosso",     label: "Rosso",     hex: "#ef4444" },
  { key: "verde",     label: "Verde",     hex: "#22c55e" },
];
export const DEFAULT_LINK_COLOR = LINK_COLORS[0].hex;
```

```ts
// lib/links/types.ts
export type CardUrlLink = { id: string; cardId: string; url: string; color: string };
export type WorkspaceLink = { id: string; workspaceId: string; url: string };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/links/__tests__/colors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/links/colors.ts lib/links/types.ts lib/links/__tests__/colors.test.ts
git commit -m "feat(links): colour palette + shared types"
```

---

## Task 6: Server actions

**Files:**
- Create: `actions/links.ts`

- [ ] **Step 1: Implement the actions**

Model the structure on `actions/card-links.ts` (same `decodeSub`, `dbAsUser`, `actionResult`).

```ts
// actions/links.ts
"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { links, cards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  UpsertCardLinkInput,
  UpsertWorkspaceLinkInput,
  RemoveCardLinkInput,
  RemoveWorkspaceLinkInput,
} from "@/lib/validation";
import { StructuredError, actionResult } from "@/lib/errors";
import { normalizeUrl } from "@/lib/links/normalize-url";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import {
  getWorkspaceRole,
  getWorkspaceRoleForCard,
} from "@/lib/permissions/guest-guard";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

// ---- Card link ----
export async function upsertCardLinkImpl(
  token: string,
  input: { cardId: string; url: string; color: string },
) {
  const parsed = UpsertCardLinkInput.parse(input);
  const url = normalizeUrl(parsed.url);
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(await getWorkspaceRoleForCard(tx, parsed.cardId, createdBy));
    const [row] = await tx
      .insert(links)
      .values({
        scope: "card",
        workspaceId: "00000000-0000-0000-0000-000000000000", // set by trigger
        cardId: parsed.cardId,
        url,
        color: parsed.color,
        createdBy,
      })
      .onConflictDoUpdate({
        target: links.cardId,
        set: { url, color: parsed.color },
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function removeCardLinkImpl(token: string, input: { cardId: string }) {
  const parsed = RemoveCardLinkInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(await getWorkspaceRoleForCard(tx, parsed.cardId, actor));
    const r = await tx
      .delete(links)
      .where(and(eq(links.cardId, parsed.cardId), eq(links.scope, "card")))
      .returning({ id: links.id });
    if (r.length === 0) throw new StructuredError("NOT_FOUND", "No link");
  });
}

// ---- Workspace link ----
export async function upsertWorkspaceLinkImpl(
  token: string,
  input: { workspaceId: string; url: string },
) {
  const parsed = UpsertWorkspaceLinkInput.parse(input);
  const url = normalizeUrl(parsed.url);
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(await getWorkspaceRole(tx, parsed.workspaceId, createdBy));
    const [row] = await tx
      .insert(links)
      .values({
        scope: "workspace",
        workspaceId: parsed.workspaceId,
        url,
        createdBy,
      })
      .onConflictDoUpdate({ target: links.workspaceId, set: { url } })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function removeWorkspaceLinkImpl(
  token: string,
  input: { workspaceId: string },
) {
  const parsed = RemoveWorkspaceLinkInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(await getWorkspaceRole(tx, parsed.workspaceId, actor));
    const r = await tx
      .delete(links)
      .where(and(eq(links.workspaceId, parsed.workspaceId), eq(links.scope, "workspace")))
      .returning({ id: links.id });
    if (r.length === 0) throw new StructuredError("NOT_FOUND", "No link");
  });
}

// ---- Wrappers ----
export async function upsertCardLink(input: { cardId: string; url: string; color: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await upsertCardLinkImpl(t, input);
    revalidatePath(`/b/${r.workspaceId}`);
    return r;
  });
}
export async function removeCardLink(input: { cardId: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    await removeCardLinkImpl(t, input);
  });
}
export async function upsertWorkspaceLink(input: { workspaceId: string; url: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await upsertWorkspaceLinkImpl(t, input);
    revalidatePath(`/w/${input.workspaceId}`);
    return r;
  });
}
export async function removeWorkspaceLink(input: { workspaceId: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    await removeWorkspaceLinkImpl(t, input);
    revalidatePath(`/w/${input.workspaceId}`);
  });
}
```

> The `onConflictDoUpdate` targets the partial unique indexes from Task 1
> (`links_card_ux` / `links_ws_ux`). Drizzle accepts the column as the conflict target; the
> partial predicate is matched by Postgres. If Drizzle rejects the partial-index target at
> runtime, fall back to: `select` existing row id → `update` if present else `insert`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Confirm `getWorkspaceRole` and `getWorkspaceRoleForCard` are exported
from `lib/permissions/guest-guard.ts` (they are — see file).

- [ ] **Step 3: Commit**

```bash
git add actions/links.ts
git commit -m "feat(links): server actions for card + workspace links"
```

---

## Task 7: `useLongPress` hook

**Files:**
- Create: `lib/hooks/use-long-press.ts`
- Create: `lib/hooks/__tests__/use-long-press.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/hooks/__tests__/use-long-press.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLongPress } from "@/lib/hooks/use-long-press";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useLongPress", () => {
  it("fires onClick on a short press", () => {
    const onClick = vi.fn(), onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onClick, onLongPress }));
    act(() => result.current.onPointerDown({ button: 0 } as any));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.onPointerUp());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });
  it("fires onLongPress after the threshold and suppresses click", () => {
    const onClick = vi.fn(), onLongPress = vi.fn();
    const { result } = renderHook(() =>
      useLongPress({ onClick, onLongPress, threshold: 500 }));
    act(() => result.current.onPointerDown({ button: 0 } as any));
    act(() => { vi.advanceTimersByTime(500); });
    act(() => result.current.onPointerUp());
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("does not long-press when onLongPress is undefined", () => {
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onClick }));
    act(() => result.current.onPointerDown({ button: 0 } as any));
    act(() => { vi.advanceTimersByTime(800); });
    act(() => result.current.onPointerUp());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hooks/__tests__/use-long-press.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/hooks/use-long-press.ts
import { useCallback, useRef } from "react";

export type LongPressHandlers = {
  onPointerDown: (e: { button?: number }) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
};

// Short click (< threshold) -> onClick. Hold (>= threshold) -> onLongPress,
// and the subsequent pointer-up does NOT fire onClick. Pointer-based so it
// works for mouse and touch. onLongPress omitted => always a click.
export function useLongPress(opts: {
  onClick: () => void;
  onLongPress?: () => void;
  threshold?: number;
}): LongPressHandlers {
  const { onClick, onLongPress, threshold = 500 } = opts;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const onPointerDown = useCallback((e: { button?: number }) => {
    if (e.button != null && e.button !== 0) return; // primary button only
    fired.current = false;
    if (!onLongPress) return;
    timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, threshold);
  }, [onLongPress, threshold]);

  const onPointerUp = useCallback(() => {
    clear();
    if (!fired.current) onClick();
    fired.current = false;
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => { clear(); fired.current = false; }, [clear]);
  const onContextMenu = useCallback((e: { preventDefault: () => void }) => {
    if (onLongPress) e.preventDefault(); // stop touch context menu during hold
  }, [onLongPress]);

  return { onPointerDown, onPointerUp, onPointerLeave, onContextMenu };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/hooks/__tests__/use-long-press.test.ts`
Expected: PASS (3 tests). If `@testing-library/react`/`renderHook` is unavailable, check
`package.json`; it is used by existing hook tests. If absent, adapt to the project's hook-test
helper.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/use-long-press.ts lib/hooks/__tests__/use-long-press.test.ts
git commit -m "feat(links): useLongPress click-vs-hold hook"
```

---

## Task 8: `LinkIcon` component

**Files:**
- Create: `components/links/link-icon.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/links/link-icon.tsx
"use client";
import { Link2 } from "lucide-react"; // chain icon
import { useLongPress } from "@/lib/hooks/use-long-press";

export type LinkIconVariant = "card" | "workspace";

function openUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

// Diamond = rotated square. Cloud handled by the `workspace` variant below.
function Diamond({ color, size = 12 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: color }}
      className="inline-block rotate-45 rounded-[2px] shrink-0"
    />
  );
}

import { Cloud } from "lucide-react";

/**
 * - No link + canEdit -> chain. Click = onEdit (create).
 * - Link set -> diamond (card) / cloud (workspace). Click = open URL.
 *   Hold ~500ms = onEdit (only when canEdit).
 * - No link + !canEdit -> renders nothing.
 */
export function LinkIcon({
  variant,
  url,
  color,
  canEdit,
  onEdit,
}: {
  variant: LinkIconVariant;
  url: string | null;
  color?: string | null;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const hasLink = !!url;
  const press = useLongPress({
    onClick: () => (hasLink ? openUrl(url!) : onEdit()),
    onLongPress: hasLink && canEdit ? onEdit : undefined,
  });

  if (!hasLink && !canEdit) return null;

  const label = !hasLink
    ? "Aggiungi link"
    : canEdit
      ? "Apri link (tieni premuto per modificare)"
      : "Apri link";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          hasLink ? openUrl(url!) : onEdit();
        }
      }}
      {...press}
      className="inline-flex items-center justify-center size-5 rounded hover:bg-fg/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
      data-testid={`link-icon-${variant}`}
      data-haslink={hasLink ? "1" : "0"}
    >
      {!hasLink ? (
        <Link2 className="size-3.5 text-fg-faint" />
      ) : variant === "workspace" ? (
        <Cloud className="size-3.5" style={{ color: "var(--accent-cyan)" }} />
      ) : (
        <Diamond color={color || "#facc15"} />
      )}
    </button>
  );
}
```

> Keyboard a11y: `Enter`/`Space` opens the URL (or the create dialog when empty). Editing an
> existing link via keyboard is provided by the edit affordance in quick view / extended edit
> (Tasks 11–12), since hold is pointer-only. Move the `import { Cloud }` to the top with the
> other imports when applying.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/links/link-icon.tsx
git commit -m "feat(links): LinkIcon (chain/diamond/cloud) with long-press"
```

---

## Task 9: `LinkEditDialog` component

**Files:**
- Create: `components/links/link-edit-dialog.tsx`

- [ ] **Step 1: Implement**

Use the same dialog primitives as `card-quick-view.tsx`
(`@/components/ui/dialog`, `@/components/ui/button`).

```tsx
// components/links/link-edit-dialog.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LINK_COLORS, DEFAULT_LINK_COLOR } from "@/lib/links/colors";

export function LinkEditDialog({
  open,
  onOpenChange,
  scope,
  initialUrl,
  initialColor,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scope: "card" | "workspace";
  initialUrl: string;
  initialColor?: string;
  onSave: (v: { url: string; color: string }) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [color, setColor] = useState(initialColor || DEFAULT_LINK_COLOR);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setUrl(initialUrl); setColor(initialColor || DEFAULT_LINK_COLOR); }
  }, [open, initialUrl, initialColor]);

  const dirty = useMemo(
    () => url.trim() !== initialUrl.trim() || (scope === "card" && color !== (initialColor || DEFAULT_LINK_COLOR)),
    [url, color, initialUrl, initialColor, scope],
  );
  const hadLink = initialUrl.trim().length > 0;

  async function save() {
    setBusy(true);
    try { await onSave({ url: url.trim(), color }); onOpenChange(false); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!onRemove) return;
    setBusy(true);
    try { await onRemove(); onOpenChange(false); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="link-edit-dialog">
        <DialogHeader>
          <DialogTitle>{hadLink ? "Modifica link" : "Aggiungi link"}</DialogTitle>
        </DialogHeader>

        <label className="block text-xs text-fg-faint mb-1">URL</label>
        <textarea
          autoFocus
          rows={3}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          data-testid="link-url-input"
          className="w-full resize-y min-h-[4.5rem] rounded-md border border-[color:var(--hairline)] bg-[color:var(--surface)] p-2 text-sm break-all outline-none focus-visible:border-[color:var(--accent-cyan)]/60"
        />

        {scope === "card" && (
          <div className="mt-3">
            <div className="text-xs text-fg-faint mb-1">Colore</div>
            <div className="flex items-center gap-2">
              {LINK_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setColor(c.hex)}
                  data-testid={`link-color-${c.key}`}
                  style={{ background: c.hex }}
                  className={`size-6 rotate-45 rounded-[2px] ${color === c.hex ? "ring-2 ring-fg ring-offset-1 ring-offset-[color:var(--surface)]" : ""}`}
                />
              ))}
              <input
                type="color"
                aria-label="Colore personalizzato"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                data-testid="link-color-custom"
                className="size-6 cursor-pointer rounded border border-[color:var(--hairline)] bg-transparent p-0"
              />
            </div>
          </div>
        )}

        <DialogFooter className="mt-4 flex items-center justify-between gap-2">
          {hadLink && onRemove ? (
            <Button variant="ghost" onClick={remove} disabled={busy}
              data-testid="link-remove" className="text-red-400 hover:text-red-300">
              Rimuovi
            </Button>
          ) : <span />}
          <Button
            onClick={() => (dirty ? save() : onOpenChange(false))}
            disabled={busy || (dirty && url.trim().length === 0)}
            data-testid="link-save"
          >
            {dirty ? "Save" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirm `DialogFooter`/`DialogHeader`/`DialogTitle` are exported from
`@/components/ui/dialog` — they are, used by `card-quick-view.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add components/links/link-edit-dialog.tsx
git commit -m "feat(links): LinkEditDialog (url + colour + remove + Close→Save)"
```

---

## Task 10: `board-store` link slice

**Files:**
- Modify: `stores/board-store.ts`

- [ ] **Step 1: Add the slice type + state + setters**

In the store's state type (near the `attachments: AttachmentRow[]` field) add:

```ts
import type { CardUrlLink } from "@/lib/links/types";
// ...in the state interface:
cardLinkByCard: Record<string, CardUrlLink>;
setCardLink: (l: CardUrlLink) => void;
removeCardLinkLocal: (cardId: string) => void;
```

In the store initialiser (where `attachments: initial.attachments` is set) add:

```ts
cardLinkByCard: initial.cardLinkByCard ?? {},
```

Add the setters next to `addAttachment`/`removeAttachment`:

```ts
setCardLink: (l) =>
  set((state) => ({ cardLinkByCard: { ...state.cardLinkByCard, [l.cardId]: l } })),
removeCardLinkLocal: (cardId) =>
  set((state) => {
    const next = { ...state.cardLinkByCard };
    delete next[cardId];
    return { cardLinkByCard: next };
  }),
```

Extend the store's `initial` prop type to include `cardLinkByCard?: Record<string, CardUrlLink>`.

> Name is `cardLinkByCard` / `setCardLink` / `removeCardLinkLocal` — do not reuse the existing
> `cardLinks` array or `addCardLink` (those are card-to-card relations).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add stores/board-store.ts
git commit -m "feat(links): board-store cardLinkByCard slice"
```

---

## Task 11: Quick view integration

**Files:**
- Modify: `components/board/card-quick-view.tsx`

- [ ] **Step 1: Wire the icon + dialog**

Read the file. The component receives a card and reads from `BoardStoreContext`. Near the
card title header, add the link icon; manage dialog open state and an `onPatch`-style edit
permission. Add these pieces:

Imports (top):
```tsx
import { LinkIcon } from "@/components/links/link-icon";
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { upsertCardLink, removeCardLink } from "@/actions/links";
import { DEFAULT_LINK_COLOR } from "@/lib/links/colors";
```

Inside the component body (after existing store selectors), add:
```tsx
const link = useBoardStore((s) => s.cardLinkByCard[card.id]);
const setCardLink = useBoardStore((s) => s.setCardLink);
const removeCardLinkLocal = useBoardStore((s) => s.removeCardLinkLocal);
const [linkOpen, setLinkOpen] = useState(false);
// canEditLink: owner/admin. Reuse the same role signal the view already has
// for write-gating (e.g. the prop/flag that enables onPatch). If a workspace
// role isn't already in scope here, thread `canEditLink: boolean` down from
// the parent that renders CardQuickView (it knows the viewer's workspace role).
```

Render next to the title:
```tsx
<LinkIcon
  variant="card"
  url={link?.url ?? null}
  color={link?.color ?? null}
  canEdit={canEditLink}
  onEdit={() => setLinkOpen(true)}
/>
<LinkEditDialog
  open={linkOpen}
  onOpenChange={setLinkOpen}
  scope="card"
  initialUrl={link?.url ?? ""}
  initialColor={link?.color ?? DEFAULT_LINK_COLOR}
  onSave={async ({ url, color }) => {
    // optimistic
    setCardLink({ id: link?.id ?? "optimistic", cardId: card.id, url, color });
    const res = await upsertCardLink({ cardId: card.id, url, color });
    if (res?.data) setCardLink({ id: res.data.id, cardId: card.id, url: res.data.url, color: res.data.color });
  }}
  onRemove={async () => {
    removeCardLinkLocal(card.id);
    await removeCardLink({ cardId: card.id });
  }}
/>
```

> `canEditLink` is the viewer's owner/admin status. The brainstorm fixed write = owner/admin
> only (members read-only on links), so it is NOT the same as the card-edit flag — thread the
> workspace role explicitly. Match the `actionResult` return shape used elsewhere
> (`res.data` / `res.error`); inspect one existing caller (e.g. an `actions/cards.ts` consumer)
> to confirm the exact field names and adapt.

- [ ] **Step 2: Manual verify (dev)**

Run: `npm run dev`, open a card quick view as an owner/admin. Empty → chain icon; click →
dialog; save URL → diamond appears; click diamond → opens tab; hold → dialog; Rimuovi → back
to chain. As a member: diamond visible, click opens, hold does nothing; no chain when empty.

- [ ] **Step 3: Commit**

```bash
git add components/board/card-quick-view.tsx
git commit -m "feat(links): quick view chain/diamond + edit dialog"
```

---

## Task 12: Extended edit (card modal) integration

**Files:**
- Modify: `components/board/card/attachments-section.tsx` (add a sibling `LinkRow`) OR create `components/board/card/link-section.tsx`
- Modify: `components/board/card-modal.tsx` (render the link section near attachments)

- [ ] **Step 1: Create the link section**

```tsx
// components/board/card/link-section.tsx
"use client";
import { useState } from "react";
import { useBoardStore } from "@/stores/board-store";
import { LinkIcon } from "@/components/links/link-icon";
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { upsertCardLink, removeCardLink } from "@/actions/links";
import { DEFAULT_LINK_COLOR } from "@/lib/links/colors";

export function LinkSection({ cardId, canEdit }: { cardId: string; canEdit: boolean }) {
  const link = useBoardStore((s) => s.cardLinkByCard[cardId]);
  const setCardLink = useBoardStore((s) => s.setCardLink);
  const removeLocal = useBoardStore((s) => s.removeCardLinkLocal);
  const [open, setOpen] = useState(false);
  if (!link && !canEdit) return null;
  return (
    <div className="flex items-center gap-2" data-testid="card-link-section">
      <span className="text-xs text-fg-faint">Link</span>
      <LinkIcon
        variant="card"
        url={link?.url ?? null}
        color={link?.color ?? null}
        canEdit={canEdit}
        onEdit={() => setOpen(true)}
      />
      {link?.url && <span className="truncate text-xs text-fg/80 max-w-[16rem]">{link.url}</span>}
      <LinkEditDialog
        open={open}
        onOpenChange={setOpen}
        scope="card"
        initialUrl={link?.url ?? ""}
        initialColor={link?.color ?? DEFAULT_LINK_COLOR}
        onSave={async ({ url, color }) => {
          setCardLink({ id: link?.id ?? "optimistic", cardId, url, color });
          const res = await upsertCardLink({ cardId, url, color });
          if (res?.data) setCardLink({ id: res.data.id, cardId, url: res.data.url, color: res.data.color });
        }}
        onRemove={async () => { removeLocal(cardId); await removeCardLink({ cardId }); }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Render it next to attachments**

In `components/board/card-modal.tsx`, find where `<AttachmentsSection cardId=… />` is rendered
and add immediately above (or below) it:
```tsx
<LinkSection cardId={card.id} canEdit={canEditLink} />
```
Add the import: `import { LinkSection } from "@/components/board/card/link-section";`
Thread `canEditLink` (owner/admin) the same way the modal already gets the viewer's role.

- [ ] **Step 3: Manual verify + commit**

Verify the link control sits next to attachments and creates/edits a link.
```bash
git add components/board/card/link-section.tsx components/board/card-modal.tsx
git commit -m "feat(links): link section in extended card edit (near attachments)"
```

---

## Task 13: Card tile diamond

**Files:**
- Modify: `components/board/card-tile.tsx`

- [ ] **Step 1: Render the diamond at the end of the title**

Read the file, find the title `<span>`/element. Immediately after the title text, render the
diamond when a link exists:
```tsx
{link?.url && (
  <span
    aria-label="Link"
    title={link.url}
    style={{ background: link.color }}
    className="ml-1 inline-block size-2.5 rotate-45 rounded-[2px] align-middle shrink-0"
  />
)}
```
Add the selector near the other store reads:
```tsx
const link = useBoardStore((s) => s.cardLinkByCard[card.id]);
```
On the tile the diamond is a non-interactive marker (the full open/edit lives in quick view /
modal) to avoid hijacking the tile's click-to-open. Keep it `aria-label`led for screen readers.

- [ ] **Step 2: Manual verify + commit**

```bash
git add components/board/card-tile.tsx
git commit -m "feat(links): diamond marker on card tile title"
```

---

## Task 14: Roadmap gantt diamond

**Files:**
- Modify: `components/roadmap/roadmap-bar.tsx`

- [ ] **Step 1: Render the diamond between the bar and assignees**

Read the file. Assignee avatars render from an `assignees: RoadmapBarAssignee[]` array near the
end of the bar. Insert an interactive `LinkIcon` just before the assignee cluster so assignees
shift right when a link exists.

Imports:
```tsx
import { LinkIcon } from "@/components/links/link-icon";
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { upsertCardLink, removeCardLink } from "@/actions/links";
import { DEFAULT_LINK_COLOR } from "@/lib/links/colors";
import { useBoardStore } from "@/stores/board-store"; // if not already imported
```

In the component body:
```tsx
const link = useBoardStore((s) => s.cardLinkByCard[card.id]);
const setCardLink = useBoardStore((s) => s.setCardLink);
const removeLocal = useBoardStore((s) => s.removeCardLinkLocal);
const [linkOpen, setLinkOpen] = useState(false);
```

Just before the assignees JSX block:
```tsx
{link?.url && (
  <>
    <LinkIcon
      variant="card"
      url={link.url}
      color={link.color}
      canEdit={canEditLink}
      onEdit={() => setLinkOpen(true)}
    />
    <LinkEditDialog
      open={linkOpen} onOpenChange={setLinkOpen} scope="card"
      initialUrl={link.url} initialColor={link.color ?? DEFAULT_LINK_COLOR}
      onSave={async ({ url, color }) => {
        setCardLink({ id: link.id, cardId: card.id, url, color });
        const res = await upsertCardLink({ cardId: card.id, url, color });
        if (res?.data) setCardLink({ id: res.data.id, cardId: card.id, url: res.data.url, color: res.data.color });
      }}
      onRemove={async () => { removeLocal(card.id); await removeCardLink({ cardId: card.id }); }}
    />
  </>
)}
```

> Roadmap-bar may not currently have the viewer's workspace role. If `canEditLink` is not in
> scope, thread it from `RoadmapView` (which knows the workspace + role). Per spec, the gantt
> only shows the diamond when a link exists (no chain placeholder here).

- [ ] **Step 2: Manual verify + commit**

Verify the diamond sits between the bar and the assignee avatars and that avatars move right
when present.
```bash
git add components/roadmap/roadmap-bar.tsx
git commit -m "feat(links): gantt diamond between task bar and assignees"
```

---

## Task 15: Roadmap list diamond

**Files:**
- Modify: `components/roadmap/roadmap-list-view.tsx`

- [ ] **Step 1: Render the diamond at the end of the title**

Read the file, find the row title element and the `OwnerAvatar` usage. After the title text
add an interactive `LinkIcon` (same wiring as Task 14: store selector, dialog, `canEditLink`).
Minimal marker + open/edit:
```tsx
{link?.url && (
  <LinkIcon
    variant="card" url={link.url} color={link.color}
    canEdit={canEditLink} onEdit={() => setLinkOpen(true)}
  />
)}
```
Add the store selector `const link = useBoardStore((s) => s.cardLinkByCard[row.id]);` (use the
row's card id) and the same `LinkEditDialog` block as Task 14.

- [ ] **Step 2: Manual verify + commit**

```bash
git add components/roadmap/roadmap-list-view.tsx
git commit -m "feat(links): roadmap list diamond at end of title"
```

---

## Task 16: Workspace cloud icon + settings management

**Files:**
- Modify: `components/workspace/workspace-switcher.tsx`
- Modify: `components/workspace/workspace-settings-form.tsx`
- Modify: `components/nav/top-nav.tsx`
- Modify: the workspace layout/loader that renders `top-nav` (to fetch the active workspace link + role)

- [ ] **Step 1: Extend the switcher props + render the cloud icon**

In `components/workspace/workspace-switcher.tsx`, extend props:
```tsx
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  activeWorkspaceLink,   // { url: string } | null
  canEditWorkspaceLink,  // boolean (viewer is owner/admin of active ws)
}: {
  workspaces: WorkspaceLite[];
  activeId?: string;
  activeWorkspaceLink?: { url: string } | null;
  canEditWorkspaceLink?: boolean;
}) {
```
Render the cloud icon as a **sibling of** `DropdownMenuTrigger` (NOT inside it), so its
click/hold don't open the menu. Wrap the existing `<DropdownMenu>…</DropdownMenu>` and the icon
in a flex container:
```tsx
<div className="inline-flex items-center gap-1">
  <DropdownMenu /* …existing… */>{/* …unchanged… */}</DropdownMenu>
  {active && activeWorkspaceLink?.url && (
    <LinkIcon
      variant="workspace"
      url={activeWorkspaceLink.url}
      canEdit={!!canEditWorkspaceLink}
      onEdit={() => {/* navigate to settings link section, see note */}}
    />
  )}
</div>
```
Import `LinkIcon`. Do NOT add the icon to the `DropdownMenuItem` list (lines ~165–186) — the
dropdown shows names only, per spec. For the workspace `onEdit` (hold), the simplest path is to
route to settings: `router.push(\`/w/${active!.id}/settings#link\`)`. (Creation lives in
settings; editing via hold deep-links there.)

> If you prefer in-place editing on hold, render a `LinkEditDialog` with `scope="workspace"`
> here wired to `upsertWorkspaceLink`/`removeWorkspaceLink`. The spec allows either; routing to
> settings is the lower-risk default and keeps the create + edit surface in one place.

- [ ] **Step 2: Add the link manager to settings**

In `components/workspace/workspace-settings-form.tsx`, add a section (anchor `id="link"`) with
the workspace link manager:
```tsx
import { LinkEditDialog } from "@/components/links/link-edit-dialog";
import { upsertWorkspaceLink, removeWorkspaceLink } from "@/actions/links";
// extend props: workspaceLink?: { url: string } | null
```
Render:
```tsx
<section id="link" className="space-y-2">
  <Label>Cartella condivisa (link)</Label>
  <p className="text-xs text-fg-faint">
    Mostrato come icona cloud accanto al nome del workspace. Visibile a tutti i membri;
    modificabile solo da owner/admin.
  </p>
  <div className="flex items-center gap-2">
    <Input id="ws-link" readOnly value={workspaceLink?.url ?? "Nessun link"} />
    <Button type="button" onClick={() => setLinkOpen(true)}>Modifica</Button>
  </div>
  <LinkEditDialog
    open={linkOpen} onOpenChange={setLinkOpen} scope="workspace"
    initialUrl={workspaceLink?.url ?? ""}
    onSave={async ({ url }) => { await upsertWorkspaceLink({ workspaceId: workspace.id, url }); }}
    onRemove={workspaceLink?.url ? async () => { await removeWorkspaceLink({ workspaceId: workspace.id }); } : undefined}
  />
</section>
```
Add `const [linkOpen, setLinkOpen] = useState(false);` to the component.

- [ ] **Step 3: Plumb data through top-nav + loader**

In the server component/layout that renders `top-nav` (find via the `<WorkspaceSwitcher>` at
`components/nav/top-nav.tsx:142`), fetch the active workspace's link and the viewer's role, and
pass them down. Query (server, via the existing server db client):
```ts
// where the layout already loads workspaces for the nav:
const wsLink = activeWorkspaceId
  ? await db.select({ url: links.url })
      .from(links)
      .where(and(eq(links.workspaceId, activeWorkspaceId), eq(links.scope, "workspace")))
      .limit(1)
  : [];
const activeWorkspaceLink = wsLink[0] ?? null;
// role: reuse however the layout already determines membership role for the active ws.
```
Pass `activeWorkspaceLink` and `canEditWorkspaceLink={role === "owner" || role === "admin"}`
into `<WorkspaceSwitcher>` and `workspaceLink` into the settings form's loader.

- [ ] **Step 4: Manual verify + commit**

As admin: settings → add a workspace link → cloud icon appears next to the active name; click
opens tab; not present in the switcher dropdown items; remove → icon disappears. As member:
cloud visible + clickable when set, no manage control. As any role with no link: no icon.
```bash
git add components/workspace/workspace-switcher.tsx components/workspace/workspace-settings-form.tsx components/nav/top-nav.tsx
git commit -m "feat(links): workspace cloud icon + settings link manager"
```

---

## Task 17: Realtime subscription + SSR seed

**Files:**
- Create: `components/links/links-realtime.tsx`
- Modify: board SSR loader (where `BoardProvider`/`board-store` initial is built) to seed `cardLinkByCard`
- Modify: board page + workspace page to mount `LinksRealtime`

- [ ] **Step 1: Implement the subscriber**

Mirror `components/workspace/board-list-realtime.tsx`.

```tsx
// components/links/links-realtime.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Refresh server-rendered views when a link is created/edited/removed by a
// peer. The actor already gets an optimistic store update + revalidatePath;
// this covers other sessions. Filter by workspace so each page only hears
// its own changes.
export function LinksRealtime({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      const nonce = Math.random().toString(36).slice(2, 8);
      const ch = supa.channel(`links:${workspaceId}:${nonce}`);
      channel = ch;
      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "links", filter: `workspace_id=eq.${workspaceId}` },
        () => router.refresh(),
      );
      ch.subscribe();
    })();
    return () => { cancelled = true; if (channel) supa.removeChannel(channel); };
  }, [workspaceId, router]);
  return null;
}
```

- [ ] **Step 2: Seed `cardLinkByCard` in the board loader**

Find the board page/server loader that builds the `board-store` `initial` payload (it already
loads `cards`, `attachments`, etc.). Add a query for the board's card links and shape them:
```ts
const linkRows = await db.select().from(links)
  .where(and(eq(links.scope, "card"), eq(links.workspaceId, boardWorkspaceId)));
const cardLinkByCard = Object.fromEntries(
  linkRows.filter((r) => r.cardId)
    .map((r) => [r.cardId as string, { id: r.id, cardId: r.cardId as string, url: r.url, color: r.color ?? "#facc15" }]),
);
// pass into the store initial: { …, cardLinkByCard }
```
(Adjust to the actual board→workspace id available in that loader; if only `boardId` is handy,
join boards→workspace_id or filter by `card_id in (board card ids)`.)

- [ ] **Step 3: Mount `LinksRealtime`**

On the board page and the workspace roadmap/home pages, render `<LinksRealtime workspaceId={…} />`
near the existing realtime components (e.g. alongside `BoardListRealtime` / `RoadmapView`).

- [ ] **Step 4: Manual verify + commit**

Open two browser sessions on the same board; create/edit/remove a link in one; the diamond
updates in the other after the refresh. Workspace cloud icon updates across sessions.
```bash
git add components/links/links-realtime.tsx <modified loader/page files>
git commit -m "feat(links): realtime CDC subscriber + SSR seed of card links"
```

---

## Task 18: End-to-end tests

**Files:**
- Create: `tests/e2e/links.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Follow the existing Playwright patterns in `tests/e2e/` (auth/setup helpers, selectors). Use
the `data-testid` hooks added above. Adapt login/seed to the project's e2e harness (see memory:
sign up in-app with `@innovina.it`, `tr_seed_demo` cookie + `/signup`).

```ts
// tests/e2e/links.spec.ts
import { test, expect } from "@playwright/test";
// import { signInAsOwner, openFirstCardQuickView } from "./helpers"; // adapt to repo helpers

test.describe("link entity", () => {
  test("owner creates a card link from quick view: chain -> diamond -> open", async ({ page, context }) => {
    // await signInAsOwner(page);
    // openFirstCardQuickView(page);
    const chain = page.getByTestId("link-icon-card").and(page.locator('[data-haslink="0"]'));
    await chain.click();
    await expect(page.getByTestId("link-edit-dialog")).toBeVisible();
    await page.getByTestId("link-url-input").fill("drive.google.com/folder/abc");
    await page.getByTestId("link-color-blu").click();
    await page.getByTestId("link-save").click(); // reads "Save" once dirty
    const diamond = page.getByTestId("link-icon-card").and(page.locator('[data-haslink="1"]'));
    await expect(diamond).toBeVisible();
    const popupPromise = context.waitForEvent("page");
    await diamond.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/drive\.google\.com\/folder\/abc/);
  });

  test("save button label toggles Close <-> Save on dirty", async ({ page }) => {
    // open an existing-link dialog
    // initial state with no change -> button says "Close"
    await expect(page.getByTestId("link-save")).toHaveText("Close");
    await page.getByTestId("link-url-input").fill("https://example.com/changed");
    await expect(page.getByTestId("link-save")).toHaveText("Save");
  });

  test("member can open but cannot edit (no chain, hold is a no-op)", async ({ page }) => {
    // sign in as member on a card that already has a link
    const icon = page.getByTestId("link-icon-card");
    await expect(icon).toHaveAttribute("data-haslink", "1");
    // long-press emulation: pointer down, wait, up — dialog must NOT appear
    const box = await icon.boundingBox();
    await page.mouse.move(box!.x + 2, box!.y + 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByTestId("link-edit-dialog")).toHaveCount(0);
  });

  test("workspace link: managed in settings, cloud icon appears, absent from switcher menu", async ({ page }) => {
    // as owner: go to /w/<id>/settings, set the link
    // assert cloud icon (link-icon-workspace, data-haslink=1) next to the active name
    await expect(page.getByTestId("link-icon-workspace")).toBeVisible();
    // open switcher dropdown; assert no link icon inside the menu items
    await page.getByTestId("workspace-switcher-trigger").click();
    await expect(page.getByTestId("link-icon-workspace")).toHaveCount(1); // only the one outside the menu
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `npx playwright test tests/e2e/links.spec.ts`
Expected: all pass (after adapting auth/seed helpers to the repo).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/links.spec.ts
git commit -m "test(links): e2e for card + workspace link flows"
```

---

## Final verification

- [ ] `npx tsc --noEmit` — clean
- [ ] `npx vitest run lib/links lib/hooks lib/permissions` — all unit suites pass
- [ ] `npx playwright test tests/e2e/links.spec.ts` — green
- [ ] `npx eslint .` (or the repo's lint script) — clean
- [ ] Manual matrix: owner/admin (create/edit/remove everywhere), member (open only), guest
      (open only, workspace link clickable), empty states (chain in card edit surfaces only;
      no cloud when workspace link unset).

---

## Notes / decisions deferred to implementation

1. **`canEditLink` plumbing.** Write = owner/admin only (members are read-only on links). This
   is a *workspace-role* signal, distinct from existing card-edit gating. Several views
   (quick view, gantt, list) don't currently hold the viewer's workspace role — thread it from
   the nearest server boundary that knows it. Do this once and pass down.
2. **`actionResult` return shape.** Snippets assume `{ data, error }`. Confirm against
   `lib/errors.ts` / an existing caller and adjust optimistic reconciliation accordingly.
3. **Drizzle partial-index upsert.** If `onConflictDoUpdate` on the partial unique index
   misbehaves, use select-then-insert/update inside the same `dbAsUser` transaction.
4. **Workspace hold-to-edit** deep-links to settings by default (creation + edit in one place).
   In-place `LinkEditDialog` with `scope="workspace"` is an allowed alternative.
