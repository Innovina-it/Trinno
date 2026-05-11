-- Generic per-field audit log for cards. Companion to 0089's
-- `card_sprint_history`, but covers the rest of the high-signal scalar
-- fields (title, priority, owner, dates, completion, sprint, parent,
-- type, estimate, story points). Sprint moves are intentionally double-
-- recorded: the dedicated table in 0089 carries open/close windows for
-- velocity attribution; this table just notes "field changed", which is
-- what activity / timeline UIs want.
--
-- Storage choice: `text` columns (not jsonb). Every tracked field is a
-- scalar (uuid, enum, timestamptz, int) that round-trips through text
-- losslessly. Skips a jsonb cast on every write and keeps the audit
-- table cheap to scan.

create table if not exists public.card_field_history (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  actor_id uuid,
  field text not null,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now()
);

create index if not exists card_field_history_card_changed_idx
  on public.card_field_history (card_id, changed_at desc);


-- Trigger fn: AFTER UPDATE on cards. For each tracked field, emit one
-- row when old/new differ. `is distinct from` handles the null-vs-null
-- case (no row emitted) and null-vs-value case (row emitted) uniformly.
-- security definer because RLS would otherwise reject inserts on behalf
-- of users who own the card row but not the audit row.
create or replace function public.cards_record_field_history()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  _actor uuid := auth.uid();
begin
  if old.title is distinct from new.title then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'title', old.title, new.title);
  end if;

  if old.priority is distinct from new.priority then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'priority', old.priority::text, new.priority::text);
  end if;

  if old.owner_id is distinct from new.owner_id then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'owner_id', old.owner_id::text, new.owner_id::text);
  end if;

  if old.start_date is distinct from new.start_date then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'start_date', old.start_date::text, new.start_date::text);
  end if;

  if old.target_date is distinct from new.target_date then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'target_date', old.target_date::text, new.target_date::text);
  end if;

  if old.due_date is distinct from new.due_date then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'due_date', old.due_date::text, new.due_date::text);
  end if;

  if old.completed_at is distinct from new.completed_at then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'completed_at', old.completed_at::text, new.completed_at::text);
  end if;

  if old.sprint_id is distinct from new.sprint_id then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'sprint_id', old.sprint_id::text, new.sprint_id::text);
  end if;

  if old.parent_card_id is distinct from new.parent_card_id then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'parent_card_id', old.parent_card_id::text, new.parent_card_id::text);
  end if;

  if old.type is distinct from new.type then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'type', old.type::text, new.type::text);
  end if;

  if old.story_points is distinct from new.story_points then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'story_points', old.story_points::text, new.story_points::text);
  end if;

  if old.estimate_min is distinct from new.estimate_min then
    insert into public.card_field_history (card_id, actor_id, field, old_value, new_value)
      values (new.id, _actor, 'estimate_min', old.estimate_min::text, new.estimate_min::text);
  end if;

  return null;
end$$;

drop trigger if exists cards_record_field_history_au on public.cards;
create trigger cards_record_field_history_au
  after update on public.cards
  for each row execute function public.cards_record_field_history();


-- RLS mirrors `cards_select` from 0006: a user can read history for a
-- card iff they can read the card itself (board member, or
-- workspace-visible board with a workspace membership). No INSERT /
-- UPDATE / DELETE policies — the trigger writes via security definer
-- and nothing else should mutate this table.
alter table public.card_field_history enable row level security;

drop policy if exists card_field_history_select on public.card_field_history;
create policy card_field_history_select on public.card_field_history for select
  using (
    exists (
      select 1
        from public.cards c
        where c.id = card_field_history.card_id
          and (
            exists (
              select 1 from public.board_members bm
                where bm.board_id = c.board_id and bm.user_id = auth.uid()
            )
            or exists (
              select 1 from public.boards b
                where b.id = c.board_id
                  and b.visibility = 'workspace'
                  and exists (
                    select 1 from public.workspace_members wm
                      where wm.workspace_id = b.workspace_id
                        and wm.user_id = auth.uid()
                  )
            )
          )
    )
  );
