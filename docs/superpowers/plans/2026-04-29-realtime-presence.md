# Trello Clone — Realtime + Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Multi-user live sync. When user A drags a card or creates a list, user B viewing the same board sees the change within ~1 second without refreshing. Plus presence: avatars of currently-viewing users in the board header.

**Architecture:** Supabase Realtime via Postgres CDC. One channel per open board (`board:{id}`). Subscribe to `postgres_changes` on `lists` and `cards` filtered by `board_id=eq.{id}` (denorm column from plan #3 makes this trivial). Presence tracked on same channel. Client-side hook dispatches events into the existing Zustand store; existing `addList`/`addCard`/`moveCard`/`moveList`/`removeCard`/`removeList` mutators reused as-is. Optimistic updates from local actions converge with CDC echoes (idempotent — same position string both ways).

**Stack additions:** none (Supabase Realtime already enabled in the JS client). Add `supabase_realtime` publication membership for the new tables.

**Out of scope:** Realtime for labels/checklists/comments (plan #5 will add them and re-enable publication then). Realtime for board/workspace metadata changes (rare; reload-only is fine).

**Definition of done:**
- Two browser contexts on the same board: A drags a card → B's UI reflects the move within 1 s.
- A creates a list → B sees the list appear.
- A archives a card → B's tile disappears.
- Each browser shows the other user's avatar in the board header (presence).
- Closing the tab removes the avatar from the other user's view (track/untrack).
- One Playwright E2E exercises the two-context drag-sync path.

---

## File Structure

**New migration:**
- `supabase/migrations/0008_realtime_publication.sql` — `alter publication supabase_realtime add table public.lists, public.cards`.

**New hooks:**
- `hooks/use-board-realtime.ts` — subscribes to CDC on mount, dispatches events into the Zustand store, unsubscribes on unmount.
- `hooks/use-board-presence.ts` — tracks `{ userId, displayName, avatarUrl }` on the channel; returns active viewer list.

**New components:**
- `components/board/presence-avatars.tsx` — avatar stack in board header.

**Modified:**
- `components/board/board-view.tsx` — call `useBoardRealtime(boardId)` and `useBoardPresence(boardId, user)`. Render `<PresenceAvatars />` in the header.
- `app/(app)/b/[boardId]/page.tsx` — pass current user (id, displayName, avatarUrl) into BoardView so presence has identity.

**New tests:**
- `tests/integration/realtime-publication.test.ts` — confirm `lists` and `cards` are members of `supabase_realtime` publication.
- `tests/e2e/realtime.spec.ts` — two browser contexts, A creates list → B sees within 2 s.

---

## Task 1: Enable Realtime publication

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/0008_realtime_publication.sql
alter publication supabase_realtime add table public.lists;
alter publication supabase_realtime add table public.cards;
```

- [ ] **Step 2: Apply**

```bash
supabase db reset
docker restart supabase_kong_trello-foundation && sleep 2
```

- [ ] **Step 3: Verify in DB**

```bash
docker exec supabase_db_trello-foundation psql -U postgres -c \
  "select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename;"
```

Expected: rows include `public.lists` and `public.cards`.

- [ ] **Step 4: Run integration tests**

```bash
npm run test:unit
```

All pre-existing tests must remain green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_realtime_publication.sql
git commit -m "feat(realtime): publish lists + cards on supabase_realtime"
```

---

## Task 2: Publication membership integration test (TDD-style)

- [ ] **Step 1: Test**

```ts
// tests/integration/realtime-publication.test.ts
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);
afterAll(async () => { await sql.end(); });

describe("supabase_realtime publication", () => {
  it("includes lists and cards", async () => {
    const rows = await sql<{ tablename: string }[]>`
      select tablename from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename in ('lists','cards')
    `;
    const names = rows.map(r => r.tablename).sort();
    expect(names).toEqual(["cards", "lists"]);
  });
});
```

- [ ] **Step 2: Run, expect PASS** (publication already in place from T1).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/realtime-publication.test.ts
git commit -m "test(realtime): publication membership for lists + cards"
```

---

## Task 3: useBoardRealtime hook

**File:** `hooks/use-board-realtime.ts` (`mkdir -p hooks` if missing)

```ts
"use client";
import { useEffect } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { useBoardStore } from "@/stores/board-store";
import type { ListRow, CardRow } from "@/lib/queries/board-snapshot";

export function useBoardRealtime(boardId: string) {
  const addList    = useBoardStore((s) => s.addList);
  const addCard    = useBoardStore((s) => s.addCard);
  const moveList   = useBoardStore((s) => s.moveList);
  const moveCard   = useBoardStore((s) => s.moveCard);
  const removeList = useBoardStore((s) => s.removeList);
  const removeCard = useBoardStore((s) => s.removeCard);
  const renameList = useBoardStore((s) => s.renameList);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    const channel = supa.channel(`board:${boardId}`);

    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lists",
          filter: `board_id=eq.${boardId}` },
        (payload) => {
          const newRow = payload.new as Partial<ListRow> | null;
          const oldRow = payload.old as Partial<ListRow> | null;
          if (payload.eventType === "INSERT" && newRow?.id) {
            addList({
              id: newRow.id, boardId,
              title: newRow.title ?? "",
              position: newRow.position ?? "",
              archived: newRow.archived ?? false,
            } as ListRow);
          } else if (payload.eventType === "UPDATE" && newRow?.id) {
            if (newRow.archived) {
              removeList(newRow.id);
            } else {
              if (newRow.position) moveList(newRow.id, newRow.position);
              if (typeof newRow.title === "string") renameList(newRow.id, newRow.title);
            }
          } else if (payload.eventType === "DELETE" && oldRow?.id) {
            removeList(oldRow.id);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cards",
          filter: `board_id=eq.${boardId}` },
        (payload) => {
          const newRow = payload.new as Partial<CardRow> | null;
          const oldRow = payload.old as Partial<CardRow> | null;
          if (payload.eventType === "INSERT" && newRow?.id && newRow.listId) {
            addCard({
              id: newRow.id, listId: newRow.listId, boardId,
              title: newRow.title ?? "",
              description: newRow.description ?? null,
              position: newRow.position ?? "",
              archived: newRow.archived ?? false,
            } as CardRow);
          } else if (payload.eventType === "UPDATE" && newRow?.id) {
            if (newRow.archived) {
              removeCard(newRow.id);
            } else if (newRow.listId && newRow.position) {
              moveCard(newRow.id, newRow.listId, newRow.position);
            }
          } else if (payload.eventType === "DELETE" && oldRow?.id) {
            removeCard(oldRow.id);
          }
        },
      )
      .subscribe();

    return () => { supa.removeChannel(channel); };
  }, [boardId, addList, addCard, moveList, moveCard, removeList, removeCard, renameList]);
}
```

> **Note on payload shape:** Supabase Realtime emits `payload.new` / `payload.old` with snake_case keys matching the DB columns (e.g., `list_id`, `board_id`, `created_at`). The cast above to `Partial<CardRow>` (camelCase) is wrong — the implementer must adjust either by reading snake_case keys directly (`(payload.new as any).list_id`) or by writing a small mapper. Pick the cleanest:
> ```ts
> function rowToCard(r: any, boardId: string): CardRow {
>   return {
>     id: r.id, listId: r.list_id, boardId,
>     title: r.title, description: r.description,
>     position: r.position, archived: r.archived,
>   };
> }
> ```
> Use a similar `rowToList(r)` for lists. Replace the inline cast with the mapper.

- [ ] **Step 1: Write `hooks/use-board-realtime.ts`** with the snake_case mapper.

- [ ] **Step 2: TS check.**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add hooks/use-board-realtime.ts
git commit -m "feat(realtime): useBoardRealtime hook (CDC → zustand store)"
```

---

## Task 4: useBoardPresence hook

**File:** `hooks/use-board-presence.ts`

```ts
"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export type Viewer = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export function useBoardPresence(boardId: string, me: Viewer) {
  const [viewers, setViewers] = useState<Viewer[]>([]);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    const channel = supa.channel(`board:${boardId}`, {
      config: { presence: { key: me.userId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Viewer>();
      const all: Viewer[] = [];
      for (const key of Object.keys(state)) {
        for (const meta of state[key]) all.push(meta);
      }
      // dedupe by userId
      const seen = new Set<string>();
      setViewers(all.filter(v => seen.has(v.userId) ? false : (seen.add(v.userId), true)));
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          userId: me.userId, displayName: me.displayName, avatarUrl: me.avatarUrl,
        });
      }
    });

    return () => { supa.removeChannel(channel); };
  }, [boardId, me.userId, me.displayName, me.avatarUrl]);

  return viewers;
}
```

- [ ] **Step 1: Write file.**
- [ ] **Step 2: TS clean.**
- [ ] **Step 3: Commit**

```bash
git add hooks/use-board-presence.ts
git commit -m "feat(realtime): useBoardPresence hook (track + presence-state list)"
```

---

## Task 5: PresenceAvatars component

**File:** `components/board/presence-avatars.tsx`

```tsx
"use client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Viewer } from "@/hooks/use-board-presence";

export function PresenceAvatars({ viewers }: { viewers: Viewer[] }) {
  if (viewers.length === 0) return null;
  return (
    <div className="flex -space-x-2">
      {viewers.slice(0, 5).map((v) => (
        <Avatar key={v.userId} className="size-7 ring-2 ring-white/40">
          <AvatarImage src={v.avatarUrl ?? undefined} />
          <AvatarFallback>{v.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {viewers.length > 5 && (
        <span className="ml-3 text-white/80 text-xs self-center">
          +{viewers.length - 5}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 1: Write file.**
- [ ] **Step 2: Commit**

```bash
git add components/board/presence-avatars.tsx
git commit -m "feat(realtime): PresenceAvatars component"
```

---

## Task 6: Wire hooks + avatars into BoardView

Modify `components/board/board-view.tsx`:

1. Add prop `currentUser: { id, displayName, avatarUrl }` and accept it from the page.
2. Call `useBoardRealtime(boardId)` inside the component.
3. Call `useBoardPresence(boardId, currentUser)` to get viewer list.
4. Render `<PresenceAvatars viewers={viewers} />` in the board header (right side, before any settings link).

Also modify `app/(app)/b/[boardId]/page.tsx`:

1. Fetch the user's profile (id from Supabase auth user; displayName from `profiles` table).
2. Pass `currentUser` to `<BoardView>`.

Sketch of page:

```tsx
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
// ... existing imports
const user = await requireUser();
const token = (await getSessionToken())!;
const snap = await getBoardSnapshot(token, boardId);
if (!snap) notFound();
const [profile] = await dbAsUser(token, async (tx) =>
  tx.select({ displayName: profiles.displayName, avatarUrl: profiles.avatarUrl })
    .from(profiles).where(eq(profiles.id, user.id))
);
return (
  <BoardView
    snapshot={snap}
    currentUser={{
      id: user.id,
      displayName: profile?.displayName ?? (user.email ?? "User"),
      avatarUrl: profile?.avatarUrl ?? null,
    }}
  />
);
```

(If the existing BoardView signature differs from `{ snapshot }` — e.g., already takes `{ board }` and store provider — adapt: pass `currentUser` alongside whatever shape it currently uses.)

- [ ] **Step 1: Modify `BoardView` signature + body.**
- [ ] **Step 2: Modify board page to fetch profile + pass currentUser.**
- [ ] **Step 3: TS clean. Build clean. Run tests.**
- [ ] **Step 4: Commit**

```bash
git add components/board/board-view.tsx app/\(app\)/b/\[boardId\]/page.tsx
git commit -m "feat(realtime): wire useBoardRealtime + presence into board view"
```

---

## Task 7: E2E — two-context realtime sync

**File:** `tests/e2e/realtime.spec.ts`

```ts
import { test, expect, request as pwRequest, type Page, type BrowserContext } from "@playwright/test";

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

async function signupAndConfirm(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("passw0rd!");
  await page.getByRole("button", { name: /sign up/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  const link = await fetchConfirmLink(email);
  await page.goto(link);
}

async function inviteAsMember(page: Page, workspaceId: string, email: string) {
  await page.goto(`/w/${workspaceId}/settings`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /^invite$/i }).click();
  await expect(page.getByText(email)).toBeVisible();
}

test("user A creates a list → user B sees it within 2 s", async ({ browser }) => {
  // Two contexts (separate cookies / sessions)
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  const emailA = `rta-${Date.now()}@example.com`;
  const emailB = `rtb-${Date.now()}@example.com`;

  await signupAndConfirm(a, emailA);
  await signupAndConfirm(b, emailB);

  // A is on /w/<wsId>; create a board
  const wsAUrl = a.url();
  await a.getByRole("button", { name: /new board/i }).click();
  await a.getByLabel("Title").fill("Realtime");
  await a.getByRole("button", { name: /create board/i }).click();
  await expect(a).toHaveURL(/\/b\/[0-9a-f-]{36}/);
  const boardUrl = a.url();
  const wsId = wsAUrl.match(/\/w\/([0-9a-f-]{36})/)![1];

  // A invites B to the workspace as member.
  // Then A re-grants B board membership by navigating to board (board membership
  // is created on board create only; for now, since boards.visibility default is
  // 'workspace', any workspace member can SELECT the board). For lists/cards
  // RLS, the lists_member_insert policy requires board_members membership —
  // so B will be able to READ but not WRITE. For this test, A is the writer
  // (creates the list); B only needs READ to see the realtime event.
  await inviteAsMember(a, wsId, emailB);

  // B navigates to the board URL.
  await b.goto(boardUrl);
  await expect(b.getByText("Realtime")).toBeVisible();

  // A creates a list named "Sync me"
  await a.getByText("+ Add a list").click();
  await a.getByPlaceholder("List title").fill("Sync me");
  await a.getByRole("button", { name: /^add list$/i }).click();

  // B should see the list within 2 s via realtime
  await expect(b.getByText("Sync me")).toBeVisible({ timeout: 2000 });
});
```

- [ ] **Step 1: Write the test.**
- [ ] **Step 2: Run `npx playwright test`.** All 4 E2E specs (auth, workspaces-boards, lists-cards-dnd, realtime) must pass.
- [ ] **Step 3: If realtime test fails:**
  - Verify Realtime is enabled in `supabase/config.toml` (it is, by default in CLI 2.95+).
  - Verify the publication membership integration test passes (T2).
  - Add `await page.waitForTimeout(500)` after subscribe before A's create — gives B's channel a moment to subscribe.
  - Increase the assertion timeout.
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/realtime.spec.ts
git commit -m "test(e2e): two-context realtime — A creates list, B sees within 2s"
```

---

## Task 8: Final verification

- [ ] `npm run test:unit` — all integration tests pass (now 23+ with the publication membership test).
- [ ] `npx playwright test` — all 4 E2E pass.
- [ ] `npm run build` — clean.
- [ ] `npx tsc --noEmit` — clean.
- [ ] Manual smoke: open the board in two browser windows (incognito for the second). Drag a card in window 1 — verify it moves in window 2 within 1 s. Verify avatar appears in both headers.

---

## Self-Review Notes

- **Spec coverage:** §3 (Supabase Realtime as the realtime path), §5.1 (one channel per board, postgres_changes), §5.3 (presence track/untrack), partially §5.2 (optimistic UI — already in plan #3, this plan adds CDC reconciliation).
- **Out of scope reminders:** No realtime for boards/workspaces metadata, no realtime for tables added in plan #5 (labels/checklists/etc.) — those tables get their own publication adds in plan #5.
- **Idempotency:** Local `moveCard` (optimistic) and CDC echo `moveCard` apply the same `(listId, position)` — sortByPosition resolves both into the same final order. No version checks needed at this granularity.
- **Known fragility:**
  - The realtime test creates user B via signup but doesn't add B to the board's `board_members` table. B can SELECT lists/cards because boards default `visibility = 'workspace'` and B is a workspace member — that's enough for the read-side realtime test.
  - The presence channel and the postgres_changes channel use the same name (`board:{id}`). Supabase docs recommend separate channels for separate concerns — but they can share. If presence sync arrives with stale viewer data after B navigates away, the `removeChannel` in cleanup will fix it on next mount.
  - The realtime test uses 2 s timeout. Local Supabase Realtime usually delivers in 100-300 ms; 2 s is a safety margin. If CI gets flaky, raise to 5 s.
