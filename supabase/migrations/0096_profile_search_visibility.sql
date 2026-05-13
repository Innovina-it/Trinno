-- 0096 — profile search visibility
--
-- The original profiles_self_select policy (0003, extended in 0074) only
-- exposes a profile to a caller who already shares a workspace or board
-- with that profile. That hides everyone the caller has not collaborated
-- with yet, which breaks the "invite someone new at workspace creation
-- time" flow: there is no shared workspace to anchor visibility.
--
-- This app is a single-tenant internal tool. The expected trust model is
-- "anyone signed in can see everyone's display name + handle to invite
-- them". This policy adds that path. The existing profiles_self_select
-- policy stays, so deeper visibility (e.g. avatar, onboarding state)
-- still requires the workspace/board overlap.

create policy profiles_authenticated_select on public.profiles for select
  using (auth.uid() is not null);

comment on policy profiles_authenticated_select on public.profiles is
  $c$Any authenticated user can read profile rows. Used by the workspace
member picker and any future "invite somebody" affordance. Stricter
joins remain on profiles_self_select; both policies OR together.$c$;
