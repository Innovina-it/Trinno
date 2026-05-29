# Roadmap completion ↔ board "done" sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ticking a card complete in the roadmap moves it to the board's "done" list (creating one if needed); un-ticking returns it to the exact list it was in before.

**Architecture:** A dedicated server action `setRoadmapCompletion` composes the existing `moveCardToStatusImpl` / `moveCardImpl` primitives and stamps `completedAt`. `updateCard` stays untouched (keeps its "never touches listId" invariant). The pre-move list is persisted in a new nullable `cards.pre_done_list_id` column (FK → `lists`, `ON DELETE SET NULL`) so reversion survives across sessions/devices. Only the roadmap bar's complete toggle is rewired; the five board-side completion toggles are unchanged.

**Tech Stack:** Next.js server actions, Drizzle ORM, Supabase Postgres + RLS, Zod validation, Vitest integration tests.

**Spec:** `docs/superpowers/specs/2026-05-29-roadmap-completion-done-sync-design.md`

---

## File Structure

- **Create** `supabase/migrations/0114_card_pre_done_list.sql` — adds the `pre_done_list_id` column.
- **Modify** `lib/db/schema.ts` — add the `preDoneListId` column to the `cards` table (single source of truth for Drizzle; no separate generated types file exists).
- **Modify** `lib/validation.ts` — add `SetRoadmapCompletionInput` Zod schema.
- **Modify** `actions/cards.ts` — add `setRoadmapCompletionImpl` + the `setRoadmapCompletion` server-action wrapper; extend the `@/lib/validation` import.
- **Modify** `components/roadmap/roadmap-bar.tsx` — `handleToggleComplete` calls `setRoadmapCompletion` instead of `updateCard`.
- **Create** `tests/integration/roadmap-completion.test.ts` — integration tests for the new action.

---

## Task 1: Add `pre_done_list_id` column (migration + Drizzle schema)

**Files:**
- Create: `supabase/migrations/0114_card_pre_done_list.sql`
- Modify: `lib/db/schema.ts:165` (insert after the `completedAt` column, before the closing `});` at line 166)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0114_card_pre_done_list.sql`:

```sql
-- Roadmap completion <-> board "done" sync.
-- Remembers the list a card sat in immediately before the roadmap
-- auto-moved it to a 'done' list, so un-completing can send it back.
-- ON DELETE SET NULL: if that list is deleted while the card is
-- completed, the revert target safely vanishes (card stays in done).
alter table public.cards
  add column pre_done_list_id uuid
  references public.lists(id) on delete set null;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `lib/db/schema.ts`, the `cards` table currently ends:

```ts
  ownerId: uuid("owner_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
```

Change to:

```ts
  ownerId: uuid("owner_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Roadmap completion sync: the list this card was in right before the
  // roadmap auto-moved it to 'done'. Consumed + cleared on un-complete.
  preDoneListId: uuid("pre_done_list_id"),
});
```

- [ ] **Step 3: Apply the migration locally**

Run: `supabase migration up`
Expected: applies pending migration `0114` only, with no error. **Do NOT run `npm run db:reset`** — it wipes the local database (all data + `auth.users`) and breaks login.

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: PASS (no errors). Confirms the Drizzle column compiles.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0114_card_pre_done_list.sql lib/db/schema.ts
git commit -m "feat(cards): add pre_done_list_id for roadmap completion sync"
```

---

## Task 2: Add the `SetRoadmapCompletionInput` validator

**Files:**
- Modify: `lib/validation.ts:210` (insert immediately after the `ArchiveCardInput` line)

- [ ] **Step 1: Add the schema**

In `lib/validation.ts`, find:

```ts
export const ArchiveCardInput = z.object({ id: Uuid, archived: z.boolean() });
```

Add directly below it:

```ts
// Roadmap complete toggle. `completed: true` stamps completed_at AND
// moves the card to the board's 'done' list; `false` clears completed_at
// AND returns the card to its pre-done list. See setRoadmapCompletionImpl.
export const SetRoadmapCompletionInput = z.object({
  cardId: Uuid,
  completed: z.boolean(),
});
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/validation.ts
git commit -m "feat(validation): add SetRoadmapCompletionInput"
```

---

## Task 3: Implement `setRoadmapCompletion` (action) with integration tests

**Files:**
- Create: `tests/integration/roadmap-completion.test.ts`
- Modify: `actions/cards.ts:19-23` (extend the `@/lib/validation` import)
- Modify: `actions/cards.ts:617` (add `setRoadmapCompletionImpl` right after `moveCardToStatusImpl` ends)
- Modify: `actions/cards.ts:1103` (add the `setRoadmapCompletion` wrapper after the `archiveCard` wrapper)

- [ ] **Step 1: Write the failing integration tests**

Create `tests/integration/roadmap-completion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { lists, cards } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setListStatusKindImpl } from "@/actions/lists";
import {
  createCardImpl,
  moveCardImpl,
  setRoadmapCompletionImpl,
} from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email, password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function makeBoard(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#fafafa",
  });
  return b;
}

async function readCard(jwt: string, id: string) {
  const [c] = await dbAsUser(jwt, async (tx) =>
    tx.select().from(cards).where(eq(cards.id, id)),
  );
  return c;
}

async function statusKindOf(jwt: string, listId: string) {
  const [l] = await dbAsUser(jwt, async (tx) =>
    tx.select({ statusKind: lists.statusKind }).from(lists).where(eq(lists.id, listId)),
  );
  return l?.statusKind ?? null;
}

describe("setRoadmapCompletionImpl", () => {
  it("complete: moves card to done list and records pre_done_list_id", async () => {
    const u = await makeUser("rc-1");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });

    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).not.toBeNull();
    expect(card.preDoneListId).toBe(todo.id);
    expect(card.listId).toBe(r.listId);
    expect(await statusKindOf(u.jwt, card.listId)).toBe("done");
  });

  it("complete then un-complete: returns card to prior list, clears pointer + completedAt", async () => {
    const u = await makeUser("rc-2");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });

    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).toBeNull();
    expect(card.preDoneListId).toBeNull();
    expect(card.listId).toBe(todo.id);
  });

  it("complete with no done list on board: creates one and moves card", async () => {
    const u = await makeUser("rc-3");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });

    expect(r.listId).not.toBe(todo.id);
    expect(await statusKindOf(u.jwt, r.listId)).toBe("done");
    const allDone = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(lists).where(and(eq(lists.boardId, b.id), eq(lists.statusKind, "done"))),
    );
    expect(allDone).toHaveLength(1);
  });

  it("complete a card already in a done list: no move, pre_done_list_id stays null", async () => {
    const u = await makeUser("rc-4");
    const b = await makeBoard(u.jwt);
    const done = await createListImpl(u.jwt, { boardId: b.id, title: "Done" });
    await setListStatusKindImpl(u.jwt, { id: done.id, statusKind: "done" });
    const c = await createCardImpl(u.jwt, { listId: done.id, title: "C" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });

    expect(r.listId).toBe(done.id);
    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).not.toBeNull();
    expect(card.preDoneListId).toBeNull();

    // Un-complete leaves it in done (nothing to revert to).
    const r2 = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });
    expect(r2.listId).toBe(done.id);
    const card2 = await readCard(u.jwt, c.id);
    expect(card2.completedAt).toBeNull();
  });

  it("manual move out of done while completed, then un-complete: does NOT yank card back", async () => {
    const u = await makeUser("rc-5");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const other = await createListImpl(u.jwt, { boardId: b.id, title: "Doing" });
    await setListStatusKindImpl(u.jwt, { id: other.id, statusKind: "in_progress" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    // User manually drags the (still-completed) card to "Doing".
    await moveCardImpl(u.jwt, { id: c.id, listId: other.id, position: "n" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });

    expect(r.listId).toBe(other.id); // stayed put
    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).toBeNull();
    expect(card.preDoneListId).toBeNull(); // pointer cleared
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/roadmap-completion.test.ts`
Expected: FAIL — `setRoadmapCompletionImpl` is not exported from `@/actions/cards` (import/type error).

- [ ] **Step 3: Extend the validation import in `actions/cards.ts`**

Change the import block at `actions/cards.ts:19-23` from:

```ts
import {
  CreateCardInput, UpdateCardInput, MoveCardInput, ArchiveCardInput,
  CascadeShiftBlockedInput, ReorderRoadmapRowInput, Uuid, CardPriority,
  BulkSetCompletedInput,
} from "@/lib/validation";
```

to:

```ts
import {
  CreateCardInput, UpdateCardInput, MoveCardInput, ArchiveCardInput,
  CascadeShiftBlockedInput, ReorderRoadmapRowInput, Uuid, CardPriority,
  BulkSetCompletedInput, SetRoadmapCompletionInput,
} from "@/lib/validation";
```

- [ ] **Step 4: Add `setRoadmapCompletionImpl`**

In `actions/cards.ts`, immediately after `moveCardToStatusImpl` ends (the closing `}` at line 617, before `export async function archiveCardImpl`), insert:

```ts
/**
 * Roadmap complete-toggle handler. Keeps the board list in lockstep with
 * the gantt completion state — WITHOUT touching updateCard (which by
 * invariant #0111 never changes listId).
 *
 * completed=true:
 *   - if the card is not already in a 'done' list: record its current
 *     list in pre_done_list_id, then move it to the board's 'done' list
 *     (moveCardToStatusImpl creates one if the board has none).
 *   - stamp completed_at = now().
 * completed=false:
 *   - clear completed_at and pre_done_list_id.
 *   - revert ONLY if the card is currently in a 'done' list AND we have a
 *     stored pre_done_list_id (still present — FK is ON DELETE SET NULL).
 *     If the user manually moved it elsewhere after completing, leave it.
 *
 * No shared transaction across the move impls — matches the established
 * cross-impl pattern (moveCardToStatusImpl, syncParentFromSubtaskImpl).
 */
export async function setRoadmapCompletionImpl(
  token: string,
  input: { cardId: string; completed: boolean },
): Promise<{ cardId: string; boardId: string; listId: string }> {
  const parsed = SetRoadmapCompletionInput.parse(input);
  const actorId = decodeSub(token);

  const probe = await dbAsUser(token, async (tx) => {
    const [card] = await tx
      .select({
        boardId: cards.boardId,
        listId: cards.listId,
        preDoneListId: cards.preDoneListId,
      })
      .from(cards)
      .where(eq(cards.id, parsed.cardId));
    if (!card) return null;
    // Completion is a non-guest write (mirrors updateCardImpl's gate).
    assertNotGuest(await getWorkspaceRoleForCard(tx, parsed.cardId, actorId));
    const [list] = await tx
      .select({ statusKind: lists.statusKind })
      .from(lists)
      .where(eq(lists.id, card.listId));
    return {
      boardId: card.boardId,
      listId: card.listId,
      preDoneListId: card.preDoneListId,
      currentStatusKind: list?.statusKind ?? null,
    };
  });
  if (!probe) throw new StructuredError("ACCESS_DENIED", "Forbidden");

  let resultListId = probe.listId;

  if (parsed.completed) {
    const movingToDone = probe.currentStatusKind !== "done";
    await dbAsUser(token, (tx) =>
      tx
        .update(cards)
        .set(
          movingToDone
            ? { completedAt: new Date(), preDoneListId: probe.listId }
            : { completedAt: new Date() },
        )
        .where(eq(cards.id, parsed.cardId)),
    );
    if (movingToDone) {
      const moved = await moveCardToStatusImpl(token, {
        cardId: parsed.cardId,
        statusKind: "done",
      });
      resultListId = moved.listId;
    }
  } else {
    const reverting =
      probe.currentStatusKind === "done" && probe.preDoneListId != null;
    await dbAsUser(token, (tx) =>
      tx
        .update(cards)
        .set({ completedAt: null, preDoneListId: null })
        .where(eq(cards.id, parsed.cardId)),
    );
    if (reverting) {
      const pos = await dbAsUser(token, async (tx) => {
        const [last] = await tx
          .select({ position: cards.position })
          .from(cards)
          .where(eq(cards.listId, probe.preDoneListId!))
          .orderBy(desc(cards.position))
          .limit(1);
        return positionBetween(last?.position ?? null, null);
      });
      const moved = await moveCardImpl(token, {
        id: parsed.cardId,
        listId: probe.preDoneListId!,
        position: pos,
      });
      resultListId = moved.listId;
    }
  }

  return { cardId: parsed.cardId, boardId: probe.boardId, listId: resultListId };
}
```

> Note: `eq`, `desc` (drizzle-orm), `dbAsUser`, `cards`, `lists`, `positionBetween`, `decodeSub`, `StructuredError`, `assertNotGuest`, `getWorkspaceRoleForCard`, `moveCardToStatusImpl`, `moveCardImpl` are all already imported/defined in `actions/cards.ts`. No new imports beyond `SetRoadmapCompletionInput` (Step 3).

- [ ] **Step 5: Add the server-action wrapper**

In `actions/cards.ts`, immediately after the `archiveCard` wrapper (ends at line 1103, before `cascadeShiftBlockedAfter`), insert:

```ts
export async function setRoadmapCompletion(input: {
  cardId: string; completed: boolean;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await setRoadmapCompletionImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/roadmap-completion.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 7: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add actions/cards.ts tests/integration/roadmap-completion.test.ts
git commit -m "feat(roadmap): sync card completion with board done list"
```

---

## Task 4: Wire the roadmap bar to the new action

**Files:**
- Modify: `components/roadmap/roadmap-bar.tsx:22` (import)
- Modify: `components/roadmap/roadmap-bar.tsx:321` (call site inside `handleToggleComplete`)

- [ ] **Step 1: Swap the import**

Change `components/roadmap/roadmap-bar.tsx:22` from:

```ts
import { archiveCard, updateCard } from "@/actions/cards";
```

to:

```ts
import { archiveCard, setRoadmapCompletion } from "@/actions/cards";
```

> If `updateCard` is referenced elsewhere in this file, keep it in the import list (`import { archiveCard, setRoadmapCompletion, updateCard }`). Verify with: `grep -n "updateCard(" components/roadmap/roadmap-bar.tsx` — the dates handler (`handleSaveDates`) and priority handler (`handleSetPriority`) use `updateCard`, so it MUST stay imported. Correct import:
> ```ts
> import { archiveCard, setRoadmapCompletion, updateCard } from "@/actions/cards";
> ```

- [ ] **Step 2: Change the completion call**

In `handleToggleComplete` (`components/roadmap/roadmap-bar.tsx`), the optimistic patch and rollback stay exactly as-is. Only the server call changes. Find:

```ts
    startTransition(async () => {
      try {
        await updateCard({ id: card.id, completed: next });
      } catch (err) {
        // Roll back optimistic patch.
        patchCardLocal(card.id, {
          completedAt: next ? null : new Date(),
          dueComplete: !next,
        });
        toast.error((err as Error).message);
      }
    });
```

Change the call line to:

```ts
    startTransition(async () => {
      try {
        await setRoadmapCompletion({ cardId: card.id, completed: next });
      } catch (err) {
        // Roll back optimistic patch.
        patchCardLocal(card.id, {
          completedAt: next ? null : new Date(),
          dueComplete: !next,
        });
        toast.error((err as Error).message);
      }
    });
```

> The card's `listId` (and therefore the bar's status fill color) updates a beat later via realtime CDC — the same reconciliation the bar already relies on. The optimistic `completedAt` patch keeps the green-ring/strikethrough flip instant. No extra optimistic listId patch is needed.

- [ ] **Step 3: Type-check + lint**

Run: `npm run type-check && npm run lint`
Expected: PASS (no errors, no new lint warnings).

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run the app (`npm run dev`), open a workspace roadmap, tick a card's complete checkbox on a board that has a Todo + Done list:
- Card gains the completed visual; on the board it appears in the Done list.
- Un-tick → card returns to its original list, completed visual cleared.

- [ ] **Step 5: Commit**

```bash
git add components/roadmap/roadmap-bar.tsx
git commit -m "feat(roadmap-bar): route complete toggle through setRoadmapCompletion"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Complete → move to done (create if none): Task 3 impl `parsed.completed` branch + tests rc-1, rc-3. ✓
- Un-complete → back to prior list: Task 3 `else` branch + test rc-2. ✓
- Persist prior list across sessions: `pre_done_list_id` column, Task 1. ✓
- Already-in-done / no-yank / deleted-list edge cases: tests rc-4, rc-5 + FK `ON DELETE SET NULL`. ✓
- Roadmap-only scope (board toggles unchanged): only `roadmap-bar.tsx` rewired, Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `setRoadmapCompletionImpl(token, { cardId, completed })` → `{ cardId, boardId, listId }`; wrapper `setRoadmapCompletion({ cardId, completed })`; validator field names `cardId`/`completed` match; `moveCardImpl` called with `{ id, listId, position }` (its actual signature); `moveCardToStatusImpl` called with `{ cardId, statusKind }` (its actual signature). ✓

**Note on `ON DELETE SET NULL` test:** the "deleted prior list" path is covered structurally by the FK constraint (Task 1) and the `probe.preDoneListId != null` guard; not separately e2e-tested because deleting a list mid-flow requires list-delete plumbing outside this plan's scope. The guard + FK make it safe by construction.
