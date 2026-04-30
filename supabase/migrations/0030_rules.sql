-- 0030_rules.sql — Automation Rules Engine (plan #18)
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trigger jsonb not null,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.rules (board_id, enabled);

create table public.rule_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  board_id uuid not null,  -- denorm
  status text not null check (status in ('success','partial','failed','skipped')),
  triggered_at timestamptz not null default now(),
  duration_ms int not null default 0,
  event jsonb not null,
  error text,
  action_results jsonb not null default '[]'::jsonb
);
create index on public.rule_runs (rule_id, triggered_at desc);

alter table public.rules enable row level security;
alter table public.rule_runs enable row level security;

create policy rules_select on public.rules for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid()
  ));
create policy rules_admin_insert on public.rules for insert
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ));
create policy rules_admin_update on public.rules for update
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ))
  with check (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ));
create policy rules_admin_delete on public.rules for delete
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rules.board_id and bm.user_id = auth.uid() and bm.role = 'admin'
  ));

create policy rule_runs_select on public.rule_runs for select
  using (exists (
    select 1 from public.board_members bm
    where bm.board_id = rule_runs.board_id and bm.user_id = auth.uid()
  ));

-- Rule runs are written via service-role from the engine (server-side).
-- No INSERT/UPDATE/DELETE policy for end users.

alter publication supabase_realtime add table public.rules;
alter publication supabase_realtime add table public.rule_runs;
