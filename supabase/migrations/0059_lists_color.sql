-- Adds an optional per-list custom color. Independent of `status_kind`:
-- when both are set the explicit color wins. NULL keeps the existing
-- behavior (color derives from status_kind, or neutral hairline).
alter table public.lists
  add column if not exists color text;
