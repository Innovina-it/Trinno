-- Add 'guest' to the workspace_role enum.
--
-- Guest is a read-only workspace participant. The only mutation a guest
-- may perform is moving a card between lists (changing its status) on
-- cards where they are listed in card_members (i.e. cards explicitly
-- assigned to them by other roles). Every other write — invites, board
-- creation, card create/update, comments, labels, members, etc. — must
-- be rejected at the server-action layer when the actor's workspace
-- role is 'guest'.
--
-- Enforcement lives in TypeScript (lib/permissions/guest-guard.ts +
-- per-action gates). RLS policies that hinge on workspace membership
-- existence (not role) continue to grant read access; mutations are
-- already funnelled through server actions, so the TS guard is the
-- choke point.

alter type public.workspace_role add value if not exists 'guest';
