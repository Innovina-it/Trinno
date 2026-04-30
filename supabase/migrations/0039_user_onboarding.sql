-- Plan #16b-γ-B (#7) — first-run tour completion flag.
--
-- Stamped on profiles when a user finishes (or skips) the in-app onboarding
-- overlay. Null means "tour pending"; the (app) layout reads this column on
-- every request and renders the overlay client-side when null AND the user
-- has at least one workspace (so the tour has something to point at).
--
-- The signup trigger (handle_new_user) leaves it null by default — that's
-- the desired behavior for fresh users.

alter table public.profiles
  add column onboarding_completed_at timestamptz;
