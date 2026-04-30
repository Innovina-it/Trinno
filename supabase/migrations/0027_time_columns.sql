alter table public.cards
  add column estimate_min int check (estimate_min is null or estimate_min >= 0),
  add column spent_min int not null default 0 check (spent_min >= 0);
