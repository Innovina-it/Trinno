-- 0108 - per-workspace holiday calendar overrides.
--
-- Default holidays live in code (lib/holidays/it.ts). This table only
-- stores deltas:
--   * name IS NULL  -> mute the preset on that date (e.g. office works
--                      on Ferragosto)
--   * name NOT NULL -> add a custom day, OR rename the preset on that
--                      date (the merge prefers the row's name over the
--                      preset's name when the iso_date matches a preset)
--
-- Primary key (workspace_id, iso_date) gives upsert-by-date for free
-- and the index needed for the merge query.

create table public.workspace_holidays (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  iso_date date not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, iso_date)
);

-- Touch updated_at on every update so the UI can show "last changed".
create or replace function public.workspace_holidays_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

create trigger workspace_holidays_touch_updated_at_biu
  before update on public.workspace_holidays
  for each row execute function public.workspace_holidays_touch_updated_at();

-- RLS: workspace members read, owners + admins write.
alter table public.workspace_holidays enable row level security;

create policy workspace_holidays_select on public.workspace_holidays for select
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = workspace_holidays.workspace_id
              and m.user_id = auth.uid())
  );

create policy workspace_holidays_admin_write on public.workspace_holidays for all
  using (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = workspace_holidays.workspace_id
              and m.user_id = auth.uid()
              and m.role in ('owner','admin'))
  )
  with check (
    exists (select 1 from public.workspace_members m
            where m.workspace_id = workspace_holidays.workspace_id
              and m.user_id = auth.uid()
              and m.role in ('owner','admin'))
  );

alter publication supabase_realtime add table public.workspace_holidays;
