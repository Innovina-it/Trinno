alter table public.cards
  add column due_date timestamptz,
  add column due_complete boolean not null default false,
  add column cover_color text;
