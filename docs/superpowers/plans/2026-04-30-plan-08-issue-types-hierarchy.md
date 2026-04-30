# Plan #8 — Issue Types + Hierarchy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Cards become typed (epic / story / task / subtask / bug). A card may have a parent card, forming a tree. Sub-tasks display under their parent inside the card modal; the parent shows progress derived from its descendants.

**Architecture:** Add `cards.type` (enum-as-text + CHECK) and `cards.parent_card_id` (self-FK ON DELETE SET NULL). A trigger prevents cycles + enforces "subtask must have a parent". A new `lib/queries/board-snapshot.ts` derived field exposes children per card. UI extends the card modal with a type picker chip, a parent breadcrumb, and a sub-tasks section.

**Out of scope:** workflow state machine per type (plan #26), per-type field schemes (#27), epics roll-up across boards (#13).

**Definition of done:**
- Card has a type chip on tile + modal; default `task`.
- Parent picker dialog finds cards in same board.
- Sub-tasks list inside card modal: inline create + check-toggle (uses existing archive flag visually).
- Tile shows type icon; if has parent, breadcrumb appears under title.
- Cannot make a card its own ancestor (cycle).
- Sub-tasks must have a parent (CHECK enforced); other types nullable.
- Existing 40 integration + 6 E2E tests still pass.
- New integration tests cover: type CHECK, parent cycle rejection, board-scoped parent search.

---

## Files

**Migration:**
- `supabase/migrations/0018_card_types.sql`

**Schema:**
- `lib/db/schema.ts` — extend cards with `type`, `parentCardId`.

**Validation:**
- `lib/validation.ts` — `CardType` enum, `SetCardTypeInput`, `SetCardParentInput`.

**Server actions:**
- `actions/cards.ts` — extend `updateCardImpl` to accept `type?` and `parentCardId?` (nullable to clear).

**Read helpers:**
- `lib/queries/board-snapshot.ts` — include `type` and `parentCardId` in CardRow.

**Store:**
- `stores/board-store.ts` — already calls `updateCard(id, patch)` which accepts arbitrary partial — no extra mutator needed.

**Components:**
- `components/board/card/type-picker.tsx` — chip-row + dropdown to set type.
- `components/board/card/parent-picker.tsx` — dialog; search-as-you-type; uses board snapshot.
- `components/board/card/subtasks-section.tsx` — list of children + inline create.
- `components/board/card-tile.tsx` — render type icon + parent breadcrumb if has parent.
- `components/board/card-modal.tsx` — render type-picker (top), parent-picker (top), subtasks-section.

**Tests:**
- `tests/integration/card-types.test.ts` — type CHECK, cycle prevention, snapshot includes type+parent.

---

## Task 1: Migration + schema

**Files:** `supabase/migrations/0018_card_types.sql`, `lib/db/schema.ts`.

```sql
-- supabase/migrations/0018_card_types.sql
alter table public.cards
  add column type text not null default 'task'
    check (type in ('epic','story','task','subtask','bug')),
  add column parent_card_id uuid references public.cards(id) on delete set null;

create index on public.cards (parent_card_id) where parent_card_id is not null;
create index on public.cards (board_id, type);

-- Subtasks must have a parent. Other types may not.
alter table public.cards add constraint cards_subtask_parent_check
  check (
    (type = 'subtask' and parent_card_id is not null)
    or (type <> 'subtask')
  );

-- Cycle / cross-board prevention. Walk ancestors; abort on self or board mismatch.
create or replace function public.cards_validate_parent()
returns trigger language plpgsql as $$
declare
  cur uuid := new.parent_card_id;
  parent_board uuid;
  hops int := 0;
begin
  if cur is null then return new; end if;
  loop
    if cur = new.id then
      raise exception 'cards: parent cycle detected';
    end if;
    select board_id, parent_card_id into parent_board, cur from public.cards where id = cur;
    if parent_board is null then
      raise exception 'cards: parent_card_id % not found', new.parent_card_id;
    end if;
    if parent_board <> new.board_id then
      raise exception 'cards: parent must be in same board';
    end if;
    hops := hops + 1;
    if hops > 1000 then
      raise exception 'cards: parent chain too deep';
    end if;
    exit when cur is null;
  end loop;
  return new;
end$$;

create trigger cards_validate_parent_biu
  before insert or update of parent_card_id, board_id on public.cards
  for each row execute function public.cards_validate_parent();
```

Drizzle (append to existing `cards` table — add the two new columns):

```ts
type: text("type").notNull().default("task"),
parentCardId: uuid("parent_card_id"),
```

(Add `text` import if absent — already present.)

Verify all integration tests still pass after `supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`.

Commit: `feat(db): cards.type + parent_card_id with cycle guard`

---

## Task 2: Validation + action

Append to `lib/validation.ts`:

```ts
export const CardType = z.enum(["epic", "story", "task", "subtask", "bug"]);
```

Extend `UpdateCardInput`:

```ts
export const UpdateCardInput = z.object({
  id: Uuid,
  title: Title.optional(),
  description: z.string().max(20_000).nullable().optional(),
  dueDate: z.union([z.string(), z.date()]).nullable().optional(),
  dueComplete: z.boolean().optional(),
  type: CardType.optional(),
  parentCardId: Uuid.nullable().optional(),
});
```

Update `actions/cards.ts` `updateCardImpl` body to set the new fields:

```ts
const patch: Record<string, unknown> = {};
if (parsed.title !== undefined) patch.title = parsed.title;
if (parsed.description !== undefined) patch.description = parsed.description;
if (parsed.dueDate !== undefined)
  patch.dueDate = parsed.dueDate instanceof Date ? parsed.dueDate : parsed.dueDate ? new Date(parsed.dueDate) : null;
if (parsed.dueComplete !== undefined) patch.dueComplete = parsed.dueComplete;
if (parsed.type !== undefined) patch.type = parsed.type;
if (parsed.parentCardId !== undefined) patch.parentCardId = parsed.parentCardId;
```

(Drizzle update with `parent_card_id: null` should use `null` not `undefined`.)

Commit: `feat(cards): updateCard accepts type + parentCardId`

---

## Task 3: Snapshot + store extension

Add `type` and `parentCardId` to the `CardRow` type in `lib/queries/board-snapshot.ts`. Include in the SELECT projection. Realtime hook's `rowToCard` mapper must also include them (snake_case `type`, `parent_card_id`).

No store mutator changes (`updateCard` already takes Partial).

Commit: `feat(snapshot): include card.type + parentCardId; realtime mapper updated`

---

## Task 4: Tests (TDD style — write first)

`tests/integration/card-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { b, l };
}

describe("card types + hierarchy", () => {
  it("defaults to task and accepts type changes", async () => {
    const u = await makeUser("ct1");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    expect((c as any).type).toBe("task");
    const updated = await updateCardImpl(u.jwt, { id: c.id, type: "epic" });
    expect((updated as any).type).toBe("epic");
  });

  it("rejects subtask without parent", async () => {
    const u = await makeUser("ct2");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await expect(
      updateCardImpl(u.jwt, { id: c.id, type: "subtask" }),
    ).rejects.toThrow();
  });

  it("rejects parent cycle", async () => {
    const u = await makeUser("ct3");
    const { l } = await setup(u.jwt);
    const a = await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    const b = await createCardImpl(u.jwt, { listId: l.id, title: "B" });
    await updateCardImpl(u.jwt, { id: b.id, parentCardId: a.id });
    await expect(
      updateCardImpl(u.jwt, { id: a.id, parentCardId: b.id }),
    ).rejects.toThrow(/cycle/);
  });

  it("can attach a subtask to a story parent", async () => {
    const u = await makeUser("ct4");
    const { l } = await setup(u.jwt);
    const story = await createCardImpl(u.jwt, { listId: l.id, title: "S" });
    await updateCardImpl(u.jwt, { id: story.id, type: "story" });
    const sub = await createCardImpl(u.jwt, { listId: l.id, title: "child" });
    const updated = await updateCardImpl(u.jwt, {
      id: sub.id, type: "subtask", parentCardId: story.id,
    });
    expect((updated as any).type).toBe("subtask");
    expect((updated as any).parentCardId).toBe(story.id);

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.parentCardId, story.id))
    );
    expect(rows.length).toBe(1);
  });
});
```

Run the test → expect FAIL (no migration yet).

After Task 1+2+3, run again → expect 4 PASS.

Run full suite (`npm run test:unit`) → 44 expected (was 40).

Commit: `test(cards): types + hierarchy + cycle guard`

---

## Task 5: TypePicker component

`components/board/card/type-picker.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { updateCard } from "@/actions/cards";
import { useBoardStore } from "@/stores/board-store";
import { toast } from "sonner";
import {
  Mountain, BookOpen, Square, CheckSquare, Bug, ChevronDown,
} from "lucide-react";

const TYPES = [
  { id: "epic",    label: "Epic",     Icon: Mountain     },
  { id: "story",   label: "Story",    Icon: BookOpen     },
  { id: "task",    label: "Task",     Icon: Square       },
  { id: "subtask", label: "Sub-task", Icon: CheckSquare  },
  { id: "bug",     label: "Bug",      Icon: Bug          },
] as const;

export type CardType = typeof TYPES[number]["id"];

export function TypeIcon({ type, className }: { type: string; className?: string }) {
  const t = TYPES.find((x) => x.id === type) ?? TYPES[2];
  return <t.Icon className={className ?? "size-3.5"} aria-label={t.label} />;
}

export function TypePicker({ cardId, type, parentCardId }: { cardId: string; type: string; parentCardId: string | null }) {
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [pending, start] = useTransition();
  const current = TYPES.find((x) => x.id === type) ?? TYPES[2];

  function set(next: CardType) {
    if (next === type) return;
    if (next === "subtask" && !parentCardId) {
      toast.error("Pick a parent first to make this a sub-task.");
      return;
    }
    updateCardLocal(cardId, { type: next });
    start(async () => {
      try { await updateCard({ id: cardId, type: next }); }
      catch (err) {
        updateCardLocal(cardId, { type });
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] transition-colors"
        disabled={pending}
      >
        <current.Icon className="size-3.5" />
        <span>{current.label.toUpperCase()}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={type} onValueChange={(v) => set(v as CardType)}>
          {TYPES.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id} className="gap-2">
              <t.Icon className="size-3.5" /> {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

## Task 6: ParentPicker component

`components/board/card/parent-picker.tsx`:

```tsx
"use client";
import { useState, useTransition, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { updateCard } from "@/actions/cards";
import { TypeIcon } from "./type-picker";
import { Link2, X, Search } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export function ParentPicker({
  cardId, parentCardId, boardId,
}: { cardId: string; parentCardId: string | null; boardId: string }) {
  const cards = useBoardStore((s) => s.cards);
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();

  const parent = parentCardId ? cards.find((c) => c.id === parentCardId) : null;

  const candidates = useMemo(() => {
    return cards
      .filter((c) => c.id !== cardId && !c.archived)
      .filter((c) => !q.trim() || c.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 30);
  }, [cards, cardId, q]);

  function setParent(nextId: string | null) {
    const prev = parentCardId;
    updateCardLocal(cardId, { parentCardId: nextId });
    start(async () => {
      try { await updateCard({ id: cardId, parentCardId: nextId }); setOpen(false); }
      catch (err) {
        updateCardLocal(cardId, { parentCardId: prev });
        toast.error((err as Error).message);
      }
    });
  }

  if (parent) {
    return (
      <div className="inline-flex items-center gap-2">
        <Link
          href={`/b/${boardId}/c/${parent.id}`}
          className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] transition-colors max-w-[16rem] truncate"
          title={parent.title}
        >
          <TypeIcon type={(parent as any).type ?? "task"} />
          <span className="truncate">{parent.title}</span>
        </Link>
        <Button
          type="button" variant="ghost" size="xs"
          onClick={() => setParent(null)}
          disabled={pending}
          aria-label="Clear parent"
        >
          <X className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button" variant="ghost" size="xs"
        onClick={() => setOpen(true)}
        className="gap-1"
      >
        <Link2 className="size-3.5" /> SET PARENT
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pick parent card</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="relative">
              <Search className="size-4 text-fg-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search cards on this board…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-hairline">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setParent(c.id)}
                    disabled={pending}
                    className="w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
                  >
                    <TypeIcon type={(c as any).type ?? "task"} />
                    <span className="text-sm truncate">{c.title}</span>
                  </button>
                </li>
              ))}
              {candidates.length === 0 && (
                <li className="px-2 py-4 text-sm text-fg-muted text-center">No matches.</li>
              )}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

---

## Task 7: SubtasksSection component

`components/board/card/subtasks-section.tsx`:

```tsx
"use client";
import { useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBoardStore } from "@/stores/board-store";
import { createCard, updateCard, archiveCard } from "@/actions/cards";
import { TypeIcon } from "./type-picker";
import { Plus, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

export function SubtasksSection({
  cardId, listId, boardId,
}: { cardId: string; listId: string; boardId: string }) {
  const cards = useBoardStore((s) => s.cards);
  const addCardLocal = useBoardStore((s) => s.addCard);
  const updateCardLocal = useBoardStore((s) => s.updateCard);
  const removeCardLocal = useBoardStore((s) => s.removeCard);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  const children = useMemo(
    () => cards.filter((c) => (c as any).parentCardId === cardId && !c.archived),
    [cards, cardId],
  );
  const done = children.filter((c) => (c as any).type === "subtask"
    && c.archived).length;
  // We don't have a 'completed' field for cards beyond archive — treat archived as done for subtasks.
  const total = children.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    start(async () => {
      try {
        const child = await createCard({ listId, title: text });
        addCardLocal(child);
        // Promote it to subtask + set parent
        const updated = await updateCard({ id: child.id, type: "subtask", parentCardId: cardId });
        updateCardLocal(child.id, { type: "subtask", parentCardId: cardId } as any);
        setText("");
        setAdding(false);
        void updated;
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function toggleArchive(child: { id: string; archived: boolean }) {
    start(async () => {
      try {
        await archiveCard({ id: child.id, archived: !child.archived });
        if (child.archived) updateCardLocal(child.id, { archived: false } as any);
        else removeCardLocal(child.id);
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-3" data-testid="subtasks-section">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">Sub-tasks</h3>
        {total > 0 && (
          <span className="mono-meta-sm text-fg-muted tabular-nums">{done}/{total} ({pct}%)</span>
        )}
      </div>
      {total > 0 && (
        <div className="h-1 w-full bg-[rgb(255_255_255/0.06)] rounded">
          <div
            className="h-full bg-fg/70 rounded transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <ul className="space-y-1">
        {children.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 text-sm border border-hairline rounded-lg p-2"
          >
            <input
              type="checkbox"
              checked={c.archived}
              onChange={() => toggleArchive({ id: c.id, archived: c.archived })}
              className="accent-fg"
            />
            <TypeIcon type={(c as any).type ?? "task"} />
            <Link
              href={`/b/${boardId}/c/${c.id}`}
              className={`flex-1 hover:underline ${c.archived ? "line-through text-fg-muted" : ""}`}
            >
              {c.title}
            </Link>
            <Button
              type="button" variant="ghost" size="xs"
              onClick={() => toggleArchive({ id: c.id, archived: c.archived })}
              disabled={pending}
            >
              <Trash2 className="size-3" />
            </Button>
          </li>
        ))}
      </ul>
      {!adding ? (
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3.5 mr-1" /> Add sub-task
        </Button>
      ) : (
        <form onSubmit={create} className="flex gap-2">
          <Input
            autoFocus value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What needs doing?"
            maxLength={120}
          />
          <Button type="submit" size="sm" disabled={pending || !text.trim()}>Add</Button>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => { setAdding(false); setText(""); }}
          >
            <X className="size-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}
```

---

## Task 8: Wire into card modal + tile

Modify `components/board/card-modal.tsx`:

- Import `TypePicker`, `ParentPicker`, `SubtasksSection`.
- Render `<TypePicker>` and `<ParentPicker>` in a small row at the very top of the modal body, before the title.
- Render `<SubtasksSection>` after the existing `ChecklistsSection` (or wherever your modal layout dictates — match the existing section style + spacing).

Modify `components/board/card-tile.tsx`:

- Import `TypeIcon`.
- Render a small `<TypeIcon type={card.type} />` in the metadata row (next to the card-code stamp).
- If `card.parentCardId` is set, render a small breadcrumb chip below the title: `↰ #TR-PARENTCODE` linking to the parent card.

Use `cardCode(parentId)` from `lib/format.ts`.

Don't break tile-indicators or hover-underline.

Commit: `feat(card-ui): type picker + parent breadcrumb + subtasks section + tile type icon`

---

## Task 9: Final verification

1. `npx tsc --noEmit` clean
2. `npm run build` clean
3. `npm run test:unit` → **44 passing** (was 40, +4 new in `card-types.test.ts`)
4. `npx playwright test` → 6 passing (no regressions)
5. Manual smoke:
   - Open a card → switch type to Story → page reloads → type persists.
   - Open another card → click "Set parent" → pick the Story → close → tile shows breadcrumb + parent's type icon.
   - Open the Story → Sub-tasks section shows the child card.
   - Try to set the Story's parent to its own subtask → should error toast.

---

## Self-Review Notes

- **Spec coverage:** Roadmap §Structure-1 (types) + §Structure-2 partial (only parent/child kind; cross-kind links land in plan #9).
- **Out of scope (deferred):** issue codes (TR-127), per-type field schemes, swim lanes by epic (plan #14).
- **Plan-author notes:**
  - `cards.archived` doubles as "complete" for sub-tasks in this slice. Plan #22 introduces a proper `done`/`status` column that supersedes this hack.
  - Parent picker is in-board only. Cross-board parents are out of scope (would require wider snapshot).
  - The cycle-prevention trigger walks ancestors at INSERT/UPDATE time. It's O(depth) per write — fine for typical hierarchies (depth < 5).
