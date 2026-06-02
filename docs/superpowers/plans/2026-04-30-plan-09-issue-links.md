# Plan #9 — Issue Links

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Two cards can be related with semantic kind: `blocks`, `relates_to`, `duplicates`. Inverse links (`is_blocked_by`, `is_duplicated_by`) auto-mirror via DB trigger.

**Architecture:** New `card_links` table with denormalized `board_id` for RLS + realtime. Trigger inserts the inverse row on insert and removes the inverse on delete. UI exposes a "Linked issues" section in the card modal and a small badge on the tile when the card has `is_blocked_by` links.

**Out of scope:** Cross-board links (links must share a board), link comments, link strength/priority.

**Definition of done:**
- Open card modal → "Linked issues" section lists existing links grouped by kind.
- Click "+ Link" → dialog with kind dropdown + card search → select target → link saves.
- Linked card visible in inverse direction with mirror kind.
- Tile shows a small "BLOCKED" badge if the card is blocked by ≥1 unresolved link.
- Removing a link removes the mirror.
- Existing 44 integration + 6 E2E tests still pass.
- 4 new integration tests cover happy-path + mirror + denial + cleanup.

---

## Files

**Migration:** `supabase/migrations/0019_card_links.sql`

**Schema:** `lib/db/schema.ts` — append `cardLinks` table.

**Validation:** `lib/validation.ts` — append `LinkKind` enum, `CreateCardLinkInput`, `DeleteCardLinkInput`.

**Server actions:** `actions/card-links.ts` — `createCardLink(Impl)`, `deleteCardLink(Impl)`.

**Read helpers:** `lib/queries/board-snapshot.ts` — include `cardLinks` collection.

**Store:** `stores/board-store.ts` — add `cardLinks: CardLinkRow[]` + `addCardLink`, `removeCardLink(id)` mutators.

**Realtime:** `hooks/use-board-realtime.ts` — subscribe to `card_links`, `rowToCardLink` mapper.

**Components:**
- `components/board/card/card-links-section.tsx` — section in card modal.
- `components/board/card/blocked-badge.tsx` — small chip used inside `card-tile.tsx`.

**Modify:**
- `components/board/card-modal.tsx` — render `<CardLinksSection cardId={...} boardId={...} />`.
- `components/board/card-tile.tsx` — render `<BlockedBadge cardId={...} />` next to the type icon.

**Tests:** `tests/integration/card-links.test.ts` — 4 tests.

---

## Task 1: Migration + Drizzle schema

`supabase/migrations/0019_card_links.sql`:

```sql
create type public.link_kind as enum (
  'blocks', 'is_blocked_by',
  'relates_to',
  'duplicates', 'is_duplicated_by'
);

create table public.card_links (
  id uuid primary key default gen_random_uuid(),
  from_card_id uuid not null references public.cards(id) on delete cascade,
  to_card_id   uuid not null references public.cards(id) on delete cascade,
  kind public.link_kind not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (from_card_id, to_card_id, kind),
  check (from_card_id <> to_card_id)
);
create index on public.card_links (board_id);
create index on public.card_links (from_card_id, kind);
create index on public.card_links (to_card_id, kind);

-- Denorm board_id from from_card on insert (single board per link)
create or replace function public.set_card_link_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  bid_from uuid;
  bid_to uuid;
begin
  select board_id into bid_from from public.cards where id = new.from_card_id;
  select board_id into bid_to   from public.cards where id = new.to_card_id;
  if bid_from is null or bid_to is null then
    raise exception 'card_links: missing card';
  end if;
  if bid_from <> bid_to then
    raise exception 'card_links: cards must share a board';
  end if;
  new.board_id := bid_from;
  return new;
end$$;
create trigger card_links_set_board_id
  before insert or update of from_card_id, to_card_id on public.card_links
  for each row execute function public.set_card_link_board_id();

-- Mirror inverse links automatically.
create or replace function public.mirror_card_link()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  inverse public.link_kind;
begin
  inverse := case new.kind
    when 'blocks'             then 'is_blocked_by'::public.link_kind
    when 'is_blocked_by'      then 'blocks'::public.link_kind
    when 'duplicates'         then 'is_duplicated_by'::public.link_kind
    when 'is_duplicated_by'   then 'duplicates'::public.link_kind
    when 'relates_to'         then 'relates_to'::public.link_kind
  end;
  if inverse is null then return new; end if;
  insert into public.card_links (from_card_id, to_card_id, kind, board_id, created_by)
  values (new.to_card_id, new.from_card_id, inverse, new.board_id, new.created_by)
  on conflict (from_card_id, to_card_id, kind) do nothing;
  return new;
end$$;

create or replace function public.unmirror_card_link()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  inverse public.link_kind;
begin
  inverse := case old.kind
    when 'blocks'             then 'is_blocked_by'::public.link_kind
    when 'is_blocked_by'      then 'blocks'::public.link_kind
    when 'duplicates'         then 'is_duplicated_by'::public.link_kind
    when 'is_duplicated_by'   then 'duplicates'::public.link_kind
    when 'relates_to'         then 'relates_to'::public.link_kind
  end;
  if inverse is null then return old; end if;
  delete from public.card_links
    where from_card_id = old.to_card_id
      and to_card_id   = old.from_card_id
      and kind         = inverse;
  return old;
end$$;

-- Use stmt-statement timing markers via session vars so the mirror itself
-- doesn't recurse infinitely. The conflict + delete-symmetry approach above
-- IS idempotent: mirroring a row that already has its inverse is a no-op
-- (ON CONFLICT DO NOTHING + the inverse delete only finds rows that exist).
create trigger card_links_mirror_aiu
  after insert on public.card_links
  for each row execute function public.mirror_card_link();
create trigger card_links_unmirror_ad
  after delete on public.card_links
  for each row execute function public.unmirror_card_link();

-- RLS: anyone who can read EITHER endpoint card can read the link.
alter table public.card_links enable row level security;

create policy card_links_select on public.card_links for select
  using (
    exists (
      select 1 from public.board_members bm
      where bm.board_id = card_links.board_id and bm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.boards b
      join public.workspace_members wm on wm.workspace_id = b.workspace_id
      where b.id = card_links.board_id and b.visibility = 'workspace'
        and wm.user_id = auth.uid()
    )
  );

create policy card_links_member_write on public.card_links for all
  using (
    exists (select 1 from public.board_members bm
            where bm.board_id = card_links.board_id and bm.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.cards c
            join public.board_members bm on bm.board_id = c.board_id
            where c.id = card_links.from_card_id and bm.user_id = auth.uid())
  );

alter publication supabase_realtime add table public.card_links;
```

Drizzle (append to `lib/db/schema.ts`, after existing tables; reuse `pgEnum` import):

```ts
export const linkKind = pgEnum("link_kind", [
  "blocks", "is_blocked_by",
  "relates_to",
  "duplicates", "is_duplicated_by",
]);

export const cardLinks = pgTable("card_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromCardId: uuid("from_card_id").notNull(),
  toCardId: uuid("to_card_id").notNull(),
  kind: linkKind("kind").notNull(),
  boardId: uuid("board_id").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Apply: `supabase db reset && docker restart supabase_kong_trello-foundation && sleep 2`. Run all tests; 44 still pass.

Commit: `feat(db): card_links table with mirror trigger + RLS + realtime`

---

## Task 2: Validation + actions

Append to `lib/validation.ts`:

```ts
export const LinkKind = z.enum([
  "blocks", "is_blocked_by",
  "relates_to",
  "duplicates", "is_duplicated_by",
]);
export const CreateCardLinkInput = z.object({
  fromCardId: Uuid,
  toCardId: Uuid,
  kind: LinkKind,
});
export const DeleteCardLinkInput = z.object({ id: Uuid });
```

`actions/card-links.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cardLinks } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { CreateCardLinkInput, DeleteCardLinkInput } from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createCardLinkImpl(
  token: string,
  input: { fromCardId: string; toCardId: string; kind: "blocks" | "is_blocked_by" | "relates_to" | "duplicates" | "is_duplicated_by" },
) {
  const parsed = CreateCardLinkInput.parse(input);
  if (parsed.fromCardId === parsed.toCardId) throw new Error("Cannot link card to itself");
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.insert(cardLinks).values({
      fromCardId: parsed.fromCardId,
      toCardId: parsed.toCardId,
      kind: parsed.kind,
      boardId: "00000000-0000-0000-0000-000000000000", // overwritten by trigger
      createdBy,
    }).onConflictDoNothing().returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteCardLinkImpl(token: string, input: { id: string }) {
  const parsed = DeleteCardLinkInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(cardLinks).where(eq(cardLinks.id, parsed.id))
      .returning({ id: cardLinks.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

// Wrappers
export async function createCardLink(input: Parameters<typeof createCardLinkImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createCardLinkImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}

export async function deleteCardLink(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteCardLinkImpl(t, input);
}
```

Commit: `feat(card-links): create/delete server actions + impls`

---

## Task 3: Snapshot + store + realtime

`lib/queries/board-snapshot.ts`:

- Add `CardLinkRow = typeof cardLinks.$inferSelect` to exports.
- Extend `BoardSnapshot` to include `cardLinks: CardLinkRow[]`.
- In `getBoardSnapshot`, add to the parallel `Promise.all`:
  ```ts
  tx.select().from(cardLinks).where(eq(cardLinks.boardId, boardId)),
  ```
  destructure `cardLinkRows` and include in returned object.

`stores/board-store.ts`:

- Add `cardLinks: CardLinkRow[]` to `BoardSnapshotInit`, `BoardState`.
- Init in `createBoardStore`. Include in `setSnapshot`.
- Add mutators:
  ```ts
  addCardLink: (l: CardLinkRow) => void;
  removeCardLink: (id: string) => void;
  ```
  Implement idempotently like the existing `addCardLabel`.

`hooks/use-board-realtime.ts`:

- Add subscription to `card_links` filtered by `board_id=eq.${boardId}`.
- INSERT → `addCardLink(rowToCardLink(payload.new))`.
- DELETE → `removeCardLink(payload.old.id)`.
- Helper `rowToCardLink`: snake → camel.

Commit: `feat(snapshot): cardLinks in board snapshot + store + realtime`

---

## Task 4: Tests

`tests/integration/card-links.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cardLinks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import { createCardLinkImpl, deleteCardLinkImpl } from "@/actions/card-links";

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
  const a = await createCardImpl(jwt, { listId: l.id, title: "A" });
  const c = await createCardImpl(jwt, { listId: l.id, title: "C" });
  return { b, a, c };
}

describe("card links", () => {
  it("creates a link and mirrors the inverse", async () => {
    const u = await makeUser("cl1");
    const { a, c } = await setup(u.jwt);
    await createCardLinkImpl(u.jwt, {
      fromCardId: a.id, toCardId: c.id, kind: "blocks",
    });
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLinks)
    );
    const blocks = rows.find((r) => r.kind === "blocks" && r.fromCardId === a.id && r.toCardId === c.id);
    const inverse = rows.find((r) => r.kind === "is_blocked_by" && r.fromCardId === c.id && r.toCardId === a.id);
    expect(blocks).toBeDefined();
    expect(inverse).toBeDefined();
  });

  it("relates_to mirrors itself", async () => {
    const u = await makeUser("cl2");
    const { a, c } = await setup(u.jwt);
    await createCardLinkImpl(u.jwt, {
      fromCardId: a.id, toCardId: c.id, kind: "relates_to",
    });
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLinks)
    );
    const ab = rows.find((r) => r.kind === "relates_to" && r.fromCardId === a.id && r.toCardId === c.id);
    const ba = rows.find((r) => r.kind === "relates_to" && r.fromCardId === c.id && r.toCardId === a.id);
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
  });

  it("delete removes both directions", async () => {
    const u = await makeUser("cl3");
    const { a, c } = await setup(u.jwt);
    const link = await createCardLinkImpl(u.jwt, {
      fromCardId: a.id, toCardId: c.id, kind: "blocks",
    });
    await deleteCardLinkImpl(u.jwt, { id: link.id });
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLinks)
    );
    expect(rows.length).toBe(0);
  });

  it("non-member cannot link cards", async () => {
    const owner = await makeUser("cl4");
    const other = await makeUser("cl4o");
    const { a, c } = await setup(owner.jwt);
    await expect(
      createCardLinkImpl(other.jwt, {
        fromCardId: a.id, toCardId: c.id, kind: "blocks",
      }),
    ).rejects.toThrow();
  });
});
```

Run, expect 4 PASS. Full suite: 48 expected.

Commit: `test(card-links): mirror trigger + RLS denial + cleanup`

---

## Task 5: CardLinksSection component

`components/board/card/card-links-section.tsx`:

```tsx
"use client";
import { useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useBoardStore } from "@/stores/board-store";
import { createCardLink, deleteCardLink } from "@/actions/card-links";
import { TypeIcon } from "./type-picker";
import { Link2, Plus, X, Search, Ban, ArrowLeftRight, Copy } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const KINDS = [
  { id: "blocks", label: "Blocks", Icon: Ban },
  { id: "is_blocked_by", label: "Blocked by", Icon: Ban },
  { id: "relates_to", label: "Relates to", Icon: ArrowLeftRight },
  { id: "duplicates", label: "Duplicates", Icon: Copy },
  { id: "is_duplicated_by", label: "Duplicated by", Icon: Copy },
] as const;

type KindId = typeof KINDS[number]["id"];

export function CardLinksSection({
  cardId, boardId,
}: { cardId: string; boardId: string }) {
  const cards = useBoardStore((s) => s.cards);
  const cardLinks = useBoardStore((s) => s.cardLinks);
  const addCardLinkLocal = useBoardStore((s) => s.addCardLink);
  const removeCardLinkLocal = useBoardStore((s) => s.removeCardLink);

  const links = useMemo(
    () => cardLinks.filter((l) => l.fromCardId === cardId),
    [cardLinks, cardId],
  );

  const grouped = useMemo(() => {
    const g: Record<string, typeof links> = {};
    for (const l of links) (g[l.kind] ??= []).push(l);
    return g;
  }, [links]);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<KindId>("blocks");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();

  const candidates = useMemo(() => {
    return cards
      .filter((c) => c.id !== cardId && !c.archived)
      .filter((c) => !q.trim() || c.title.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 30);
  }, [cards, cardId, q]);

  function add(targetId: string) {
    start(async () => {
      try {
        const link = await createCardLink({
          fromCardId: cardId, toCardId: targetId, kind,
        });
        addCardLinkLocal(link);
        // The mirror row will arrive via realtime
        setOpen(false);
        setQ("");
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  function remove(id: string) {
    start(async () => {
      try { await deleteCardLink({ id }); removeCardLinkLocal(id); }
      catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="space-y-3" data-testid="card-links-section">
      <div className="flex items-center justify-between">
        <h3 className="mono-meta text-fg">Linked issues</h3>
        <Button
          type="button" variant="ghost" size="xs"
          onClick={() => setOpen(true)} disabled={pending}
        >
          <Plus className="size-3.5 mr-0.5" /> LINK
        </Button>
      </div>

      {Object.keys(grouped).length === 0 && (
        <p className="text-sm text-fg-faint italic">No linked issues.</p>
      )}

      {KINDS.map((k) => {
        const list = grouped[k.id];
        if (!list?.length) return null;
        return (
          <div key={k.id} className="space-y-1">
            <div className="mono-meta-sm text-fg-faint inline-flex items-center gap-1.5">
              <k.Icon className="size-3" /> {k.label.toUpperCase()}
            </div>
            <ul className="space-y-1">
              {list.map((l) => {
                const target = cards.find((c) => c.id === l.toCardId);
                return (
                  <li
                    key={l.id}
                    className="flex items-center gap-2 text-sm border border-hairline rounded-lg p-2"
                  >
                    {target ? (
                      <>
                        <TypeIcon
                          type={(target as { type?: string }).type ?? "task"}
                          className="size-3.5"
                        />
                        <Link
                          href={`/b/${boardId}/c/${target.id}`}
                          className="flex-1 truncate hover:underline"
                        >
                          {target.title}
                        </Link>
                      </>
                    ) : (
                      <span className="flex-1 text-fg-muted italic">Card not in this board</span>
                    )}
                    <Button
                      type="button" variant="ghost" size="xs"
                      onClick={() => remove(l.id)}
                      disabled={pending}
                      aria-label="Remove link"
                    >
                      <X className="size-3" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link an issue</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]">
                <Link2 className="size-3.5" />
                <span>{(KINDS.find((k) => k.id === kind) ?? KINDS[0]).label.toUpperCase()}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup value={kind} onValueChange={(v) => setKind(v as KindId)}>
                  {KINDS.map((k) => (
                    <DropdownMenuRadioItem key={k.id} value={k.id} className="gap-2">
                      <k.Icon className="size-3.5" /> {k.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="relative">
              <Search className="size-4 text-fg-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                autoFocus
                placeholder="Search cards on this board…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-hairline">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => add(c.id)}
                    disabled={pending}
                    className="w-full text-left px-2 py-2 flex items-center gap-2 hover:bg-[rgb(255_255_255/0.04)] transition-colors"
                  >
                    <TypeIcon type={(c as { type?: string }).type ?? "task"} />
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
    </div>
  );
}
```

---

## Task 6: BlockedBadge for tile

`components/board/card/blocked-badge.tsx`:

```tsx
"use client";
import { Ban } from "lucide-react";
import { useBoardStore } from "@/stores/board-store";

export function BlockedBadge({ cardId }: { cardId: string }) {
  const cardLinks = useBoardStore((s) => s.cardLinks);
  const count = cardLinks.filter(
    (l) => l.fromCardId === cardId && l.kind === "is_blocked_by",
  ).length;
  if (count === 0) return null;
  return (
    <span
      className="chip inline-flex items-center gap-1 text-fg/80"
      title={`Blocked by ${count} card${count === 1 ? "" : "s"}`}
      data-testid="tile-blocked"
    >
      <Ban className="size-3" />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
```

---

## Task 7: Wire into modal + tile

Modify `components/board/card-modal.tsx`:
- Import `CardLinksSection`.
- Render after `SubtasksSection` (or near other relational sections).
- Pass `cardId={card.id}` and `boardId={boardId}`.

Modify `components/board/card-tile.tsx`:
- Import `BlockedBadge`.
- Render in the metadata row alongside `TypeIcon` (e.g., between TypeIcon and the card-code stamp).

Commit: `feat(card-ui): linked-issues section + blocked badge on tile`

---

## Task 8: Final verification

- `npx tsc --noEmit` clean
- `npm run build` clean
- `npm run test:unit` → **48 passing** (44 + 4 new)
- `npx playwright test` → 6 passing
- Manual smoke:
  - Open card A → "+ LINK" → kind "Blocks" → pick card C → save → link visible in A.
  - Open card C → "Blocked by" group shows A.
  - Tile of C shows `Ban` chip with count 1.
  - Remove the link from A → both sides disappear.

---

## Self-Review Notes

- **Spec coverage:** Roadmap §Structure-2.
- **Out of scope (deferred):** Cross-board links (would require changing the board_id check), link metadata (note/comment per link), priority/strength.
- **Hazards:**
  - The mirror trigger calls `INSERT ... ON CONFLICT DO NOTHING`, which means inserting the inverse manually is also idempotent. The `unmirror` trigger uses targeted `DELETE` so removing one side cleans both.
  - RLS for INSERT requires the user to be a board member of the FROM card's board. Since both cards must share a board (enforced by trigger), this is sufficient.
  - The `<BlockedBadge>` reads only `is_blocked_by` rows where `fromCardId === cardId` — that's the inverse side after mirroring, so it correctly reflects "this card is blocked by N others".
