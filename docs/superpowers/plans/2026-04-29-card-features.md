# Trello Clone — Card Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add the rich card features Trello users expect: **labels**, **card members (assignees)**, **checklists**, **due dates**, **comments**, **attachments**. All exposed inside the existing card modal, all RLS-enforced, all delivered via Server Actions, all live-synced via the Realtime publication added in plan #4.

**Architecture:** Same patterns as plans 1-4. New tables get the standard treatment: schema migration → RLS policies (read=board members; write=board members) → INSERT bootstrap policy → Drizzle mirror → impl/wrapper Server Actions with TDD → realtime publication. Attachments use Supabase Storage with signed-URL upload via `/api/upload`.

**Tech additions:** none new at the npm level. New SQL tables only.

**Out of scope:** Activity log writes (plan #6), search across content (plan #6), CI hardening (plan #7), AI/auto-suggest features.

**Definition of done:**
- A board admin can create/rename/delete a label (color + name) on a board.
- A card can be tagged with multiple labels; tiles in the board view show colored stripes.
- A card has a list of assigned members with avatars; a workspace member can be assigned/unassigned.
- A card can have multiple checklists each with multiple items; items can be checked/unchecked, added, removed.
- A card can have a due date (and a completion flag); tile shows the due-date pill.
- A card can have a thread of comments; only the author can edit/delete their own.
- A card can have file attachments (uploaded to Supabase Storage); shown in the modal with download links.
- All of the above sync live to other viewers via the existing Realtime channel.

---

## File Structure

**Migrations:**
- `0009_card_columns.sql` — adds `due_date`, `due_complete`, `cover_color` to `cards`.
- `0010_labels.sql` — `labels`, `card_labels` tables + RLS.
- `0011_card_members.sql` — `card_members` table + RLS.
- `0012_checklists.sql` — `checklists`, `checklist_items` + RLS + denorm `board_id` triggers.
- `0013_comments.sql` — `comments` table + RLS (author-only edit/delete).
- `0014_attachments.sql` — `attachments` table + RLS + Storage bucket creation.
- `0015_realtime_publication_extend.sql` — add the new tables to `supabase_realtime`.

**Storage:** bucket `card-attachments` (private; RLS on `storage.objects`).

**Schema:** append to `lib/db/schema.ts`.

**Validation:** append to `lib/validation.ts`.

**Server Actions:**
- `actions/labels.ts` — create/rename/delete + toggleCardLabel.
- `actions/card-members.ts` — toggleCardMember.
- `actions/checklists.ts` — create/rename/delete checklist; add/toggle/remove items.
- `actions/card-due.ts` — setDueDate, toggleDueComplete.
- `actions/comments.ts` — create/edit/delete.
- `actions/attachments.ts` — register/delete attachments (paired with the upload route).

**API route:** `app/api/upload/route.ts` — mints signed-URL for direct upload to Storage.

**Read helpers (extend `lib/queries/board-snapshot.ts` or add `lib/queries/card-detail.ts`):**
- `getCardDetail(token, cardId)` — labels, members, checklists+items, comments, attachments.
- Extend `getBoardSnapshot` to include label assignments and minimal member/checklist counts (for tile decoration).

**Components (under `components/board/card/*`):**
- `card-label-stripes.tsx` (in tile)
- `card-due-pill.tsx` (in tile)
- `label-picker.tsx` (modal popover)
- `member-picker.tsx`
- `checklist-section.tsx`
- `due-date-picker.tsx`
- `comment-section.tsx`
- `attachment-section.tsx`

**Card modal:** modify the existing `card-modal.tsx` to render these sections.

**Realtime hook:** extend `useBoardRealtime` to subscribe to the new tables filtered by `board_id`.

**Tests:** integration test per action file (`tests/integration/actions/{labels,card-members,checklists,comments,attachments}.test.ts`) + one E2E that exercises each feature end-to-end.

---

## Decomposition

This plan is large. Implementer should treat each feature as an independent slice. Each slice has the same shape:

1. **SQL migration** (table + indexes + denorm trigger if needed + RLS read/write/delete policies + INSERT bootstrap + add to `supabase_realtime` publication).
2. **Drizzle mirror** appended to `lib/db/schema.ts`.
3. **Validation schemas** appended to `lib/validation.ts`.
4. **Server actions** with impl/wrapper split; integration tests assert RLS + happy path + non-member denial.
5. **Wire into `useBoardRealtime`** so other viewers see changes.
6. **UI section** inside the card modal (or board view for label stripes).

The slices are listed below in the order they should land; each commit is one slice.

---

## Slice A: extend `cards` columns (due date, cover)

- [ ] **Migration `0009_card_columns.sql`**

```sql
alter table public.cards
  add column due_date timestamptz,
  add column due_complete boolean not null default false,
  add column cover_color text;
```

- [ ] **Drizzle schema:** add `dueDate: timestamp("due_date", { withTimezone: true })`, `dueComplete: boolean("due_complete").notNull().default(false)`, `coverColor: text("cover_color")` to `cards`.
- [ ] **Existing tests** must still pass.
- [ ] **Commit:** `feat(db): cards.due_date, due_complete, cover_color columns`

---

## Slice B: labels (TDD)

- [ ] **Migration `0010_labels.sql`**

```sql
create table public.labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null default '',
  color text not null
);
create index on public.labels (board_id);

create table public.card_labels (
  card_id uuid not null references public.cards(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  primary key (card_id, label_id)
);
create index on public.card_labels (board_id);

create or replace function public.set_card_label_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.board_id := bid;
  return new;
end;
$$;
create trigger card_labels_set_board_id
  before insert or update of card_id on public.card_labels
  for each row execute function public.set_card_label_board_id();

alter table public.labels enable row level security;
alter table public.card_labels enable row level security;

-- read: board members or workspace members of workspace-visible boards
create policy labels_select on public.labels for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = labels.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = labels.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));

create policy labels_member_write on public.labels for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = labels.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = labels.board_id and bm.user_id = auth.uid()
  ));

create policy card_labels_select on public.card_labels for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_labels.board_id and bm.user_id = auth.uid()
  ) or exists (
    select 1 from public.boards b
    join public.workspace_members wm on wm.workspace_id = b.workspace_id
    where b.id = card_labels.board_id and b.visibility = 'workspace' and wm.user_id = auth.uid()
  ));

create policy card_labels_member_write on public.card_labels for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_labels.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.board_members bm on bm.board_id = c.board_id
    where c.id = card_labels.card_id and bm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.labels;
alter publication supabase_realtime add table public.card_labels;
```

- [ ] **Drizzle:** `labels`, `cardLabels` tables.
- [ ] **Validation:** `CreateLabelInput`, `RenameLabelInput`, `DeleteLabelInput`, `ToggleCardLabelInput`.
- [ ] **`actions/labels.ts`** with impls: `createLabelImpl`, `renameLabelImpl`, `deleteLabelImpl`, `toggleCardLabelImpl` (insert if missing, delete if present).
- [ ] **Test:** `tests/integration/actions/labels.test.ts` covers create+toggle+delete + non-member denial.
- [ ] **Commit:** `feat(labels): table, RLS, actions, realtime publication`

---

## Slice C: card members (assignees)

- [ ] **Migration `0011_card_members.sql`**

```sql
create table public.card_members (
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  primary key (card_id, user_id)
);
create index on public.card_members (board_id);

create or replace function public.set_card_member_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.board_id := bid;
  return new;
end;
$$;
create trigger card_members_set_board_id
  before insert or update of card_id on public.card_members
  for each row execute function public.set_card_member_board_id();

alter table public.card_members enable row level security;

create policy card_members_select on public.card_members for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_members.board_id and bm.user_id = auth.uid()
  ));

create policy card_members_member_write on public.card_members for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = card_members.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.board_members bm on bm.board_id = c.board_id
    where c.id = card_members.card_id and bm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.card_members;
```

- [ ] Drizzle, validation, `actions/card-members.ts` (`toggleCardMemberImpl`), test, commit.
- [ ] **Commit:** `feat(card-members): assignee table + toggle action`

---

## Slice D: checklists + items

- [ ] **Migration `0012_checklists.sql`**

```sql
create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  title text not null,
  position text not null,
  created_at timestamptz not null default now()
);
create index on public.checklists (board_id, card_id, position);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade, -- denorm
  text text not null,
  completed boolean not null default false,
  position text not null,
  created_at timestamptz not null default now()
);
create index on public.checklist_items (board_id, checklist_id, position);

-- denorm board_id from card → checklist
create or replace function public.set_checklist_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.cards where id = new.card_id;
  if bid is null then raise exception 'card_id % not found', new.card_id; end if;
  new.board_id := bid;
  return new;
end;
$$;
create trigger checklists_set_board_id
  before insert or update of card_id on public.checklists
  for each row execute function public.set_checklist_board_id();

-- denorm board_id from checklist → checklist_items
create or replace function public.set_checklist_item_board_id()
returns trigger language plpgsql security definer set search_path = public
as $$
declare bid uuid;
begin
  select board_id into bid from public.checklists where id = new.checklist_id;
  if bid is null then raise exception 'checklist_id % not found', new.checklist_id; end if;
  new.board_id := bid;
  return new;
end;
$$;
create trigger checklist_items_set_board_id
  before insert or update of checklist_id on public.checklist_items
  for each row execute function public.set_checklist_item_board_id();

alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;

create policy checklists_select on public.checklists for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklists.board_id and bm.user_id = auth.uid()
  ));
create policy checklists_member_write on public.checklists for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklists.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.cards c
    join public.board_members bm on bm.board_id = c.board_id
    where c.id = checklists.card_id and bm.user_id = auth.uid()
  ));

create policy checklist_items_select on public.checklist_items for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklist_items.board_id and bm.user_id = auth.uid()
  ));
create policy checklist_items_member_write on public.checklist_items for all
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = checklist_items.board_id and bm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.checklists cl
    join public.board_members bm on bm.board_id = cl.board_id
    where cl.id = checklist_items.checklist_id and bm.user_id = auth.uid()
  ));

alter publication supabase_realtime add table public.checklists;
alter publication supabase_realtime add table public.checklist_items;
```

- [ ] Drizzle, validation, `actions/checklists.ts` (createChecklist, renameChecklist, deleteChecklist, addChecklistItem, toggleChecklistItem, removeChecklistItem). Tests. Commit.

---

## Slice E: comments

- [ ] **Migration `0013_comments.sql`** — table + denorm trigger + RLS (read=board members; INSERT/SELECT for any board member; UPDATE/DELETE limited to author OR board admin).
- [ ] Drizzle, validation, `actions/comments.ts` (createComment, editComment, deleteComment). Tests. Commit.

```sql
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.comments (board_id, card_id, created_at desc);

-- (board_id denorm via trigger from card_id)
-- (RLS:
--   select: board members
--   insert: board members AND author_id = auth.uid()
--   update/delete: author_id = auth.uid()  OR  board admin
-- )
```

(Implementer fills in trigger + policies following Slice D shape.)

`alter publication supabase_realtime add table public.comments;`

---

## Slice F: attachments

- [ ] **Migration `0014_attachments.sql`**

```sql
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  storage_path text not null, -- key inside the 'card-attachments' bucket
  filename text not null,
  mime text not null,
  size_bytes int not null,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index on public.attachments (board_id, card_id);

-- denorm trigger same shape as comments

-- bucket creation (idempotent)
insert into storage.buckets (id, name, public)
values ('card-attachments', 'card-attachments', false)
on conflict (id) do nothing;

-- RLS on attachments table:
--   select/insert/update/delete: board members for the attachments.board_id
-- RLS on storage.objects (bucket=card-attachments):
--   read: any board member of the card it belongs to
--   write: any board member who created the row in attachments
```

- [ ] **API route `app/api/upload/route.ts`:** authenticated POST that receives `{ cardId, filename, mime, sizeBytes }`, looks up the user, builds a path `cards/{cardId}/{uuid}-{filename}`, calls `supa.storage.from('card-attachments').createSignedUploadUrl(path)`. Returns `{ path, signedUrl, token }`. Client does the actual PUT.
- [ ] **`actions/attachments.ts`:** `registerAttachmentImpl(token, { cardId, storagePath, filename, mime, sizeBytes })` — INSERT into `attachments`. `deleteAttachmentImpl(token, { id })` — also calls `supa.storage.from(...).remove([path])`.
- [ ] Tests. Commit.

`alter publication supabase_realtime add table public.attachments;`

---

## Slice G: realtime publication round-up + hook extension

- [ ] **Migration `0015_realtime_publication_extend.sql`** — empty if all the above already added their tables in their own migrations. Skip if so. (This file exists only as a fallback if any slice forgot.)
- [ ] **Extend `hooks/use-board-realtime.ts`** with handlers for: labels, card_labels, card_members, checklists, checklist_items, comments, attachments. Each follows the same pattern: filter by `board_id=eq.{boardId}`, dispatch appropriate store action.
  - The Zustand store needs new collections + mutators added in the same change. Add them following the existing array+`sortByPosition` pattern.

---

## Slice H: UI

The card modal (`components/board/card-modal.tsx`) gains sections, in this order:
- LabelStripes (tile-side) + LabelPicker (modal)
- DueDatePicker
- MemberPicker
- ChecklistSection (multiple checklists, items per)
- AttachmentSection (file picker → signed-URL upload → register)
- CommentSection (thread, edit/delete own)

Each component uses the existing pattern:
- Reads from store via selector.
- Mutations call Server Action wrappers; on success, optionally apply local state (CDC will reconcile shortly anyway).

Implementer should ship UI **per-slice** (label UI alongside slice B, etc.) rather than as one giant final commit, so each slice ships working software.

---

## Slice I: E2E

- [ ] Add a single E2E `tests/e2e/card-features.spec.ts` that covers:
  1. Create a card, open the modal.
  2. Add a label → close → tile shows colored stripe.
  3. Set due date → tile shows due-date pill.
  4. Add a checklist + 2 items, check one → progress bar moves.
  5. Add a comment → it appears in the thread.
  6. Reload the page → all of the above still present.

Attachments E2E is harder (file upload through signed URL); leave a `test.fixme` with a comment.

- [ ] **Commit:** `test(e2e): card features (labels, due date, checklist, comment)`

---

## Final verification

- All integration tests pass (target: ~30 with the new slices).
- All E2E pass (5 specs).
- `npm run build` clean.
- `npx tsc --noEmit` clean.
- Manual smoke: open a card, exercise each feature, see it sync between two browsers.

---

## Self-Review Notes

- **Spec coverage:** §4.1 full (labels, card_labels, card_members, checklists, checklist_items, comments, attachments — all the tables the design called for); §3 (Server Actions only path); §4.5 (RLS with denormalized `board_id`); §5.1 (realtime per-board on every new table); §10 (existing decisions reused).
- **Out of scope reminders:** activity log writes (that's plan #6's `SECURITY DEFINER` triggers).
- **Plan-author trade-off:** This plan describes seven independent slices in less depth than the foundation/workspaces/lists plans. Each slice is mechanically the same shape as those earlier slices. A subagent can apply the pattern. If the subagent is uncertain on any specific slice, it should write the migration first, then the test, then the action — strict TDD as elsewhere.
- **Known fragility:**
  - The attachment upload path requires Storage RLS *and* table RLS to both be configured. If the storage RLS is too tight, uploads fail; if too loose, anyone with a path can read. Default to mirroring the table RLS (board members only).
  - Comments' `edited_at` should be set by the action, not a trigger, so the implementer can choose semantics (e.g., don't bump `edited_at` for trivial whitespace).
  - The denorm trigger pattern is now used 6+ times. Consider extracting a shared `set_board_id_from_<parent>` SQL helper in a future plan, but not now.
