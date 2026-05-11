-- Adds an explicit single-owner column on cards alongside the existing
-- multi-assignee `card_members` table. `owner_id` is the person ultimately
-- accountable for the card; `card_members` are collaborators. NULL =
-- unowned (default).
--
-- on delete set null: owner profile removal must not orphan/cascade-delete
-- the card. Card RLS already covers visibility/write; no extra policy.

alter table public.cards
  add column if not exists owner_id uuid references public.profiles(id) on delete set null;

create index if not exists cards_owner_id_idx
  on public.cards (owner_id) where owner_id is not null;
