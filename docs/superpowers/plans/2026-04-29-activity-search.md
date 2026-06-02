# Trello Clone — Activity Log + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Two features:
1. **Activity log** — every meaningful mutation (card create/move/archive, list create/rename, comment, label add, member assign, etc.) writes an `activity` row via `SECURITY DEFINER` triggers. UI shows board-level activity feed + per-card activity inside the card modal.
2. **Search** — full-text search across cards (title + description) within a workspace, scoped by RLS. Header search box → results panel.

**Architecture:** Activity rows written by DB triggers (not by app code) so the source of truth is uniform regardless of how the mutation was issued. Search uses Postgres `tsvector` indexed column with a generated trigger keeping it in sync. Both ride the existing RLS gates.

**Out of scope:** notifications/email, AI summaries of activity, advanced filters in search (only basic title/description match).

**Definition of done:**
- Creating/renaming/moving/archiving lists or cards adds an `activity` row.
- Adding labels, assigning members, posting/editing comments adds activity rows.
- Activity feed component on the board (right sidebar) shows recent activity for the board.
- Card modal shows recent activity scoped to that card.
- Header search box: type a query → see matching cards across workspaces the user can read.
- Click a result → navigate to the card.

---

## File Structure

**Migrations:**
- `0015_activity_table.sql` — `activity` table, indexes, RLS (SELECT only — writes go via triggers).
- `0016_activity_triggers.sql` — `SECURITY DEFINER` trigger functions for: lists, cards, comments, labels, card_labels, card_members, checklists, checklist_items, attachments, board_members.
- `0017_card_search.sql` — add `tsv` `tsvector` column on `cards`, GIN index, trigger to maintain it on title/description change.

**Schema:** append `activity` to `lib/db/schema.ts`.

**Validation:** `SearchInput` (query string).

**Read helpers:**
- `lib/queries/activity.ts` — `listActivityForBoard(token, boardId, limit)`, `listActivityForCard(token, cardId, limit)`.
- `lib/queries/search.ts` — `searchCards(token, query, limit)`.

**Server Actions:** none new (search is a read; activity is a side-effect of existing mutations).

**Components:**
- `components/board/activity-feed.tsx` — board sidebar.
- `components/board/card/card-activity.tsx` — modal section.
- `components/nav/search-box.tsx` — header input + results dropdown.

**Routes:**
- modify `components/nav/top-nav.tsx` to render `<SearchBox />`.
- modify `components/board/board-view.tsx` (or board page) to mount `<ActivityFeed />` collapsible.
- modify `components/board/card-modal.tsx` to add card-activity section.

**Tests:**
- `tests/integration/activity-triggers.test.ts` — assert each mutation writes a row with correct type + payload.
- `tests/integration/search.test.ts` — full-text search returns matches, RLS hides others.
- `tests/e2e/search-and-activity.spec.ts` — single E2E exercising both.

---

## Slice A — activity table + read helpers

- [ ] **Migration `0015_activity_table.sql`**

```sql
create table public.activity (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  card_id uuid references public.cards(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.activity (board_id, created_at desc);
create index on public.activity (card_id, created_at desc) where card_id is not null;

alter table public.activity enable row level security;

-- SELECT for board members (or workspace members of workspace-visible boards)
create policy activity_select on public.activity for select
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = activity.board_id and bm.user_id = auth.uid())
    or exists (
      select 1 from public.boards b
      join public.workspace_members wm on wm.workspace_id = b.workspace_id
      where b.id = activity.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policy for the user role.
-- Triggers (SECURITY DEFINER) bypass RLS by design.

alter publication supabase_realtime add table public.activity;
```

- [ ] **Drizzle:**
```ts
export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").notNull(),
  cardId: uuid("card_id"),
  actorId: uuid("actor_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```
(Import `jsonb` from `drizzle-orm/pg-core` and `sql` from `drizzle-orm`.)

- [ ] **Read helpers `lib/queries/activity.ts`:**

```ts
import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { activity, profiles } from "@/lib/db/schema";

export async function listActivityForBoard(token: string, boardId: string, limit = 50) {
  return dbAsUser(token, async (tx) =>
    tx.select({
      id: activity.id, type: activity.type, payload: activity.payload,
      cardId: activity.cardId, actorId: activity.actorId, createdAt: activity.createdAt,
      actorName: profiles.displayName,
    })
      .from(activity)
      .leftJoin(profiles, eq(profiles.id, activity.actorId))
      .where(eq(activity.boardId, boardId))
      .orderBy(desc(activity.createdAt))
      .limit(limit),
  );
}

export async function listActivityForCard(token: string, cardId: string, limit = 50) {
  return dbAsUser(token, async (tx) =>
    tx.select({
      id: activity.id, type: activity.type, payload: activity.payload,
      actorId: activity.actorId, createdAt: activity.createdAt,
      actorName: profiles.displayName,
    })
      .from(activity)
      .leftJoin(profiles, eq(profiles.id, activity.actorId))
      .where(eq(activity.cardId, cardId))
      .orderBy(desc(activity.createdAt))
      .limit(limit),
  );
}
```

- [ ] **Commit:** `feat(activity): table + read helpers (SELECT-only RLS)`

---

## Slice B — activity triggers (TDD)

- [ ] **Test FIRST `tests/integration/activity-triggers.test.ts`**

Verify that creating a card, renaming a list, adding a comment, etc. each emit one activity row with the correct `type` and reasonable `payload`.

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { activity } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, renameListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl, archiveCardImpl, moveCardImpl } from "@/actions/cards";
import { createCommentImpl } from "@/actions/comments";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("activity triggers", () => {
  it("emits rows for list/card/comment lifecycle", async () => {
    const u = await makeUser("act");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#000",
    });
    const l1 = await createListImpl(u.jwt, { boardId: b.id, title: "L1" });
    const l2 = await createListImpl(u.jwt, { boardId: b.id, title: "L2" });
    await renameListImpl(u.jwt, { id: l1.id, title: "L1!" });
    const c = await createCardImpl(u.jwt, { listId: l1.id, title: "C" });
    const { generateKeyBetween } = await import("fractional-indexing");
    await moveCardImpl(u.jwt, { id: c.id, listId: l2.id, position: generateKeyBetween(null, null) });
    await archiveCardImpl(u.jwt, { id: c.id, archived: true });
    await createCommentImpl(u.jwt, { cardId: c.id, body: "hi" });

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select({ type: activity.type, payload: activity.payload, cardId: activity.cardId })
        .from(activity).where(eq(activity.boardId, b.id))
        .orderBy(desc(activity.createdAt))
    );

    const types = rows.map(r => r.type).reverse();
    // The order of board/list creation activities is implementation defined,
    // but these types must all be present:
    expect(new Set(types)).toEqual(new Set([
      "list.create", "list.create", "list.rename",
      "card.create", "card.move", "card.archive", "comment.create",
    ]));
  });
});
```

(Adjust the expected `Set` if your trigger function names use different `type` strings — keep them consistent.)

- [ ] **Migration `0016_activity_triggers.sql`** — write trigger functions for:
  - `lists`: INSERT → `list.create`, UPDATE of title → `list.rename`, UPDATE of position → `list.move`, UPDATE of archived → `list.archive`/`list.unarchive`, DELETE → `list.delete`
  - `cards`: INSERT → `card.create`, UPDATE of title → `card.rename`, UPDATE of description → `card.description`, UPDATE of position OR list_id → `card.move`, UPDATE of archived → `card.archive`/`card.unarchive`, UPDATE of due_date or due_complete → `card.due`, DELETE → `card.delete`
  - `comments`: INSERT → `comment.create`, UPDATE → `comment.edit`, DELETE → `comment.delete`
  - `card_labels`: INSERT → `card.label.add`, DELETE → `card.label.remove`
  - `card_members`: INSERT → `card.member.assign`, DELETE → `card.member.unassign`
  - `board_members`: INSERT → `board.member.add`, DELETE → `board.member.remove`
  - (Skip checklists/attachments for this slice; can be added later.)

Pattern (one shared helper to avoid 30 copies):

```sql
create or replace function public.log_activity(
  p_board_id uuid, p_card_id uuid, p_type text, p_payload jsonb)
returns void language sql security definer set search_path = public
as $$
  insert into public.activity (board_id, card_id, actor_id, type, payload)
  values (p_board_id, p_card_id, auth.uid(), p_type, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function public.activity_lists_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.board_id, null, 'list.create', jsonb_build_object('title', new.title));
  return null;
end$$;

create trigger activity_lists_aiu after insert on public.lists
  for each row execute function public.activity_lists_after_insert();

-- and so on for each event type
```

For UPDATE triggers, distinguish by `OLD.<col> IS DISTINCT FROM NEW.<col>` checks inside the function.

- [ ] **Apply migration, run test → expect PASS.**
- [ ] **Commit:** `feat(activity): SECURITY DEFINER triggers on lists/cards/comments/labels/members`

---

## Slice C — search

- [ ] **Migration `0017_card_search.sql`**

```sql
alter table public.cards add column tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) stored;

create index cards_tsv_idx on public.cards using gin (tsv);
```

(Generated column means no trigger needed; Postgres maintains it.)

- [ ] **Test `tests/integration/search.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { searchCards } from "@/lib/queries/search";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("searchCards", () => {
  it("returns matches by title; RLS hides other users' cards", async () => {
    const a = await makeUser("sr-a");
    const b = await makeUser("sr-b");
    const wsa = await createWorkspaceImpl(a.jwt, { name: "WSA" });
    const ba = await createBoardImpl(a.jwt, {
      workspaceId: wsa.id, title: "BA",
      backgroundKind: "color", backgroundValue: "#000",
    });
    const la = await createListImpl(a.jwt, { boardId: ba.id, title: "L" });
    await createCardImpl(a.jwt, { listId: la.id, title: "Find me please" });

    const wsb = await createWorkspaceImpl(b.jwt, { name: "WSB" });
    const bb = await createBoardImpl(b.jwt, {
      workspaceId: wsb.id, title: "BB",
      backgroundKind: "color", backgroundValue: "#000",
    });
    const lb = await createListImpl(b.jwt, { boardId: bb.id, title: "L" });
    await createCardImpl(b.jwt, { listId: lb.id, title: "Hidden secret" });

    const aResults = await searchCards(a.jwt, "find");
    expect(aResults.length).toBe(1);
    expect(aResults[0].title).toBe("Find me please");

    // A queries for B's content — RLS hides it.
    const aResultsForB = await searchCards(a.jwt, "secret");
    expect(aResultsForB.length).toBe(0);
  });
});
```

- [ ] **Read helper `lib/queries/search.ts`:**

```ts
import { sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";

export async function searchCards(token: string, query: string, limit = 20) {
  if (!query.trim()) return [];
  return dbAsUser(token, async (tx) => {
    const rows = await tx.execute(sql`
      select c.id, c.title, c.description, c.list_id, c.board_id,
             b.title as board_title
      from public.cards c
      join public.boards b on b.id = c.board_id
      where c.archived = false
        and c.tsv @@ websearch_to_tsquery('simple', ${query})
      order by ts_rank(c.tsv, websearch_to_tsquery('simple', ${query})) desc
      limit ${limit}
    `);
    return (rows as unknown as Array<{
      id: string; title: string; description: string | null;
      list_id: string; board_id: string; board_title: string;
    }>).map(r => ({
      id: r.id, title: r.title, description: r.description,
      listId: r.list_id, boardId: r.board_id, boardTitle: r.board_title,
    }));
  });
}
```

- [ ] **Commit:** `feat(search): tsvector on cards + searchCards helper`

---

## Slice D — UI

### components/nav/search-box.tsx (client component)

Type-as-you-search with debounce; results dropdown shows boardTitle + cardTitle; clicking navigates to `/b/{boardId}/c/{cardId}`. Use a Server Action wrapper:

```ts
// actions/search.ts
"use server";
import { searchCards } from "@/lib/queries/search";
import { getSessionToken, requireUser } from "@/lib/auth";

export async function search(query: string) {
  await requireUser();
  const token = (await getSessionToken())!;
  return searchCards(token, query);
}
```

Wire into `components/nav/top-nav.tsx` between the workspace switcher and the user info.

### components/board/activity-feed.tsx

Renders the result of `listActivityForBoard`. Each row is:

```
{actorName} {humanizedType} {payload-snippet}
{relative time}
```

Add a server-component wrapper that fetches the activity and a client-component skeleton for live updates via realtime (subscribe to `activity` filter `board_id=eq.{id}` and prepend new rows). Initial version: just SSR-fetch and render — no live update — to keep scope small. Live updates can land in a follow-up.

Add a toggle button in the board header to show/hide the sidebar.

### components/board/card/card-activity.tsx

Same shape as activity feed but per-card. Mount inside the card modal below the comments section.

- [ ] **Commit:** `feat(activity-ui): board activity sidebar + card activity in modal + search box`

---

## Slice E — E2E

`tests/e2e/search-and-activity.spec.ts`:

1. Sign up + create board + list + card.
2. Open card modal, edit title, close.
3. Open the activity panel → assert "card.create" and "card.rename" entries visible.
4. Type the new card title in the search box → click result → land on the card.

- [ ] **Commit:** `test(e2e): activity feed + search`

---

## Final verification

- All integration tests pass (target: 40+ now).
- All E2E pass (6 specs).
- Build clean, TS clean.

---

## Self-Review Notes

- **Spec coverage:** §4.1 (activity table); §4.5 (RLS — SELECT only for users; writes via SECURITY DEFINER per spec note); §6 (UI not specified for activity but plan §11 lists it); §10 (decision to do triggers, not app-code, kept).
- **Scope discipline:**
  - Search is title+description only. No card members, label names, or comment search.
  - Activity feed UI is SSR-only initially. Live updates via realtime can land in a tiny follow-up commit.
  - Triggers cover the most-used events. checklists, attachments not yet wired — same pattern can be added later.
- **Plan-author hazards:**
  - The trigger pattern `OLD.<col> IS DISTINCT FROM NEW.<col>` matters: a UPDATE that doesn't change anything must NOT emit a row. Implementer should test this implicitly — running the test with no changes in title shouldn't emit a `list.rename` row.
  - `auth.uid()` in trigger functions returns `null` when DB is accessed via service role (not via PostgREST/Drizzle-with-claims). Tests that touch DB via raw `postgres` client will see `actor_id = null`. Acceptable.
  - The `tsv` generated column requires Postgres 12+ (Supabase always satisfies). Re-running `supabase db reset` after the migration is necessary for older databases.
