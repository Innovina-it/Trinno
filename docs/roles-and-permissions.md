# User Roles and Permissions — System-Wide Functionality Report

## About this document

This report describes everything a user can and cannot do inside the `trello-foundation` application, organised by the user role they hold. It is intended for product, engineering and operations readers who need a single reference that explains the full permission model end to end, with pointers into the source code for verification.

The system was divided into six functional parts and investigated in parallel by separate agents. Each part below preserves the same structure: who the roles are, what they can do, what they cannot do, how the rule is enforced (with `file:line` links you can click into), and any non-obvious edge cases.

The application is built on Next.js 15 (App Router) with Supabase Postgres as the data layer. Almost all permission checks live inside Postgres as Row-Level Security (RLS) policies and SQL trigger functions defined in `supabase/migrations/*.sql`. The Next.js server actions in `actions/*.ts` simply forward the caller's JWT to the database; the database is the source of truth for who can do what. A small number of server-side cron routes use the Supabase service-role key to bypass RLS for system tasks like scanning for SLA breaches and sending the daily email digest.

Generated on 2026-05-13.

---

## Overview of the role model

Before going into each part, it helps to understand how privileges accumulate as a user moves through the system.

When a person first signs up, they exist only as an **authenticated user**. They have no special powers — they can edit their own profile, set their notification preferences and create a brand-new workspace, but nothing else. The signup trigger automatically gives them a personal workspace where they are the owner, so in practice every user has at least one workspace they fully control from day one.

Inside a **workspace** there are three roles: `owner`, `admin` and `member`. The owner is the user who created the workspace (or whoever inherited the role through a manual update). Admins share every privilege with the owner except the ability to delete the workspace itself. Members are the default — they can read everything in the workspace, but they cannot rename it, invite people, or create new boards. They can, however, edit cards on boards marked "workspace-visible" thanks to a special rule explained below.

Inside a **board** there are three roles: `admin`, `member` and `observer`. Board admins can do everything to that board: rename it, delete it, change its visibility, invite people, manage components and automation rules. Board members can do everything an admin can do *to the contents of the board* (lists, cards, comments, attachments, checklists), but cannot manage the board itself or its membership. Observers are strictly read-only — they can look but never write.

Inside a **dashboard** there are effectively three roles: owner (implicit, stored on `dashboards.owner_id`), editor (shares write access for gadgets and dashboard name) and viewer (read-only). Workspace members get implicit viewer access to any dashboard scoped to their workspace, even without an ACL entry.

Two structural rules glue these scopes together and are worth committing to memory because they explain several otherwise-surprising behaviours:

- **Workspace members can write on workspace-visible boards.** Originally, a workspace member who had not been explicitly added to a board could see workspace-visible boards but not edit them. Migration [`0048_workspace_writes_visible_boards.sql`](../supabase/migrations/0048_workspace_writes_visible_boards.sql) changed this: any workspace member can now create, edit and delete lists and cards on any board whose visibility is set to `workspace`. The board itself (name, visibility, membership) still requires admin privileges.
- **Being added to a board automatically makes you a workspace member.** When a user is added to `board_members`, a SECURITY DEFINER trigger from [`0063_board_member_implies_workspace_member.sql`](../supabase/migrations/0063_board_member_implies_workspace_member.sql) automatically inserts a `workspace_members` row at `role = 'member'`. It uses `ON CONFLICT DO NOTHING`, so it never downgrades an existing higher role.

With that context in place, the rest of the report walks through each functional area.

---

# Part 1 — Authentication, Sign-up, Onboarding and Profile

## The user states

A user in this system can be in one of three states.

**Anonymous** users have no Supabase session. `auth.uid()` returns `null` and almost every Row-Level Security policy in the database will deny them. They can still reach the public auth pages (`/login`, `/signup`, `/forgot-password`, `/reset-password`) because those routes are deliberately not guarded.

**Authenticated** users have a valid Supabase session. Their `profiles` row exists because a database trigger creates it automatically when they sign up — they cannot exist in the database without one.

**Onboarded** users are authenticated users whose `profiles.onboarding_completed_at` column has been set to a timestamp. Important to note: there is **no capability difference between authenticated and onboarded users at the database layer**. The onboarding flag only suppresses the tour overlay in the UI. A user can do everything from the moment they sign up.

There is no admin or owner tier at the auth layer itself. All privilege elevation happens at the workspace or board level, covered in later parts.

## What a user can do

An **unauthenticated visitor** can reach the login, signup, forgot-password and reset-password pages and submit those forms. With `enable_confirmations=false` in Supabase, signing up issues a session immediately without an email-confirmation step.

An **authenticated user** (regardless of onboarding state) can:

- Log out, via [`actions/auth.ts:5`](../actions/auth.ts#L5), which calls `supabase.auth.signOut()`.
- View their own profile read-only at `/settings/profile` ([`app/(app)/settings/profile/page.tsx:5`](../app/(app)/settings/profile/page.tsx#L5)).
- Read and write their notification preferences per kind and channel via [`actions/user-notification-prefs.ts:36`](../actions/user-notification-prefs.ts#L36) (`setNotificationPref`).
- Opt in or out of the daily email digest via [`actions/user-notification-prefs.ts:83`](../actions/user-notification-prefs.ts#L83) (`setEmailDigestPref`). The flag is stored on `profiles.email_digest_optin` and defaults to `false`.
- Mark the onboarding tour as complete via [`actions/onboarding.ts:18`](../actions/onboarding.ts#L18). This stamps `onboarding_completed_at`. The action is protected by the `profiles_self_update` RLS policy, which only permits updates to the user's own row.
- Search for other users by handle or display name via [`actions/profile-search.ts:157`](../actions/profile-search.ts#L157). The underlying RLS policy `profiles_authenticated_select` ([`0096:16`](../supabase/migrations/0096_profile_search_visibility.sql#L16)) was deliberately written to allow any authenticated user to read any profile, because this is treated as a single-tenant internal tool.
- Look up another user by email via [`actions/profile-lookup.ts:21`](../actions/profile-lookup.ts#L21), which calls the SECURITY DEFINER function `find_user_id_by_email` from [`0005_find_user_helper.sql`](../supabase/migrations/0005_find_user_helper.sql).
- Visit `/me` and `/me/timeline`, which only require a valid session (`requireUser()`).

## What a user cannot do

| Restriction | Detail | Where enforced |
|---|---|---|
| Visit `/me` or `/settings/*` while logged out | `requireUser()` redirects to `/login` | [`lib/auth.ts:22-23`](../lib/auth.ts#L22) |
| Edit another user's profile | RLS policy `profiles_self_update` restricts UPDATE to `auth.uid() = id` | [`0003_rls.sql:89-90`](../supabase/migrations/0003_rls.sql#L89) |
| Read the `auth.users` table directly | The email-lookup function runs as SECURITY DEFINER and the broader profile-search code uses the service-role key server-side only | [`0005:10-11`](../supabase/migrations/0005_find_user_helper.sql#L10), [`actions/profile-search.ts:8-16`](../actions/profile-search.ts#L8) |
| Be blocked at signup by email domain | The migration that would have restricted signups to `innovina.it` exists as `0056_auth_domain_allowlist.sql.disabled`, but the `.disabled` extension means it was never applied. Today any email domain can sign up. | [`0056` (disabled)](../supabase/migrations/0056_auth_domain_allowlist.sql.disabled#L19) |
| Delete their own account | No server action, route or UI element for self-service account deletion exists anywhere in the codebase | — (feature absent) |
| Upload an avatar | The `profiles.avatar_url` column exists ([`lib/db/schema.ts:30`](../lib/db/schema.ts#L30)) but there is no upload action or UI surface | — (feature absent) |
| Change their handle | Handles are slugified from the email at signup and there is no edit path | [`0066_profile_handle.sql:55-75`](../supabase/migrations/0066_profile_handle.sql#L55) |

## Edge cases worth knowing

- **Profile auto-creation on sign-up.** The `handle_new_user()` trigger fires on every `auth.users` INSERT ([`0002_profile_trigger.sql:12`](../supabase/migrations/0002_profile_trigger.sql#L12)). In a single SECURITY DEFINER transaction it creates the `profiles` row, creates a default workspace named `<local_part>'s Workspace`, and adds the user to that workspace with role `owner`. A user therefore never exists without a profile and a workspace they own.
- **Handle auto-assignment.** The trigger slugifies the email's local part into `[a-z0-9_.-]`, deduplicates with a numeric suffix, and falls back to an 8-character UUID prefix if necessary.
- **Session lifetime.** From `supabase/config.toml`: JWTs expire after 7 days, the absolute session timebox is 30 days, and the inactivity timeout is 7 days. Refresh-token rotation is enabled. These values were recently extended per ops request (commit `3bb86a8`).
- **Email confirmation is disabled.** The signup callback at `app/(auth)/auth/callback/route.ts` handles both the confirmation-code path and the no-code path, but in practice the deployment runs with `enable_confirmations=false`, so signups become active sessions immediately.
- **Service-role key in profile search.** When searching profiles by email prefix, the server-side code uses `SUPABASE_SERVICE_ROLE_KEY` to call `auth.admin.listUsers` ([`actions/profile-search.ts:11-15`](../actions/profile-search.ts#L11)). If the env var is missing in development, search degrades silently to handle/name only — no error is surfaced.

## Performance and speed improvements (ordered by expected impact)

| # | Improvement | Why it helps | Where to act |
|---|---|---|---|
| 1 | Replace `auth.admin.listUsers()` in profile search with a denormalised `email` column on `profiles` plus a `pg_trgm` index | The admin API is paginated and slow; pulling the full user list on every keystroke dominates search latency. A trigram-indexed prefix scan is sub-millisecond. | [`actions/profile-search.ts:11-15`](../actions/profile-search.ts#L11), new migration adding `profiles.email` + trigram index |
| 2 | Add `gin_trgm_ops` indexes on `profiles.handle` and `profiles.display_name` | Search currently does ILIKE without a trigram index, so every keystroke is a full sequential scan over `profiles`. | New migration `CREATE INDEX … USING gin (handle gin_trgm_ops)` |
| 3 | Memoise `requireUser()` per request | The session is currently re-fetched from middleware and from each server action; one cached call per request would remove a round-trip on every action. | [`lib/auth.ts:21-25`](../lib/auth.ts#L21), wrap with `React.cache` |
| 4 | Cache the decoded JWT `sub` instead of re-decoding in every action | `decodeSub()` runs base64 + JSON.parse on the JWT in each `setNotificationPref`/`setEmailDigestPref`/etc. call. Once per request is enough. | [`actions/user-notification-prefs.ts:15-18`](../actions/user-notification-prefs.ts#L15) |
| 5 | Defer the default-workspace creation in `handle_new_user()` to a queued job | The signup trigger does three inserts in one transaction; on a slow database this adds noticeable latency to the signup response. Lower priority because signup volume is low. | [`0002_profile_trigger.sql:12`](../supabase/migrations/0002_profile_trigger.sql#L12) |

---

# Part 2 — Workspaces and Workspace Membership

The workspace is the top-level container in the system. Every board, sprint, milestone, version, dashboard and gadget belongs to exactly one workspace.

## The roles

Workspace membership is governed by a Postgres enum declared in [`0001_init.sql:17`](../supabase/migrations/0001_init.sql#L17):

```sql
create type public.workspace_role as enum ('owner','admin','member');
```

Three roles exist; there is no observer role at the workspace level.

- **Owner.** The workspace creator. Their identity is recorded both on `workspaces.owner_id` and in a `workspace_members` row at `role = 'owner'`. They are the only role that can delete the workspace.
- **Admin.** Shares every privilege with the owner except deletion. The helper function `is_workspace_admin()` returns true for both roles, so most RLS checks treat them identically.
- **Member.** The default role for newcomers. Read-only at the workspace layer, but can write to board content on workspace-visible boards thanks to the rule from migration `0048`.

## What owners and admins can do

A workspace owner or admin has full administrative control. They can rename the workspace, toggle settings such as `auto_assign_creator`, invite new members at any role short of owner, change other members' roles, and remove members. They can also create, archive and delete boards, and write to lists and cards on any visible board. The owner additionally has the exclusive right to delete the entire workspace.

These privileges are enforced by RLS:

- Update workspace metadata: policy `workspaces_owner_update`, which checks `is_workspace_admin()` ([`0003:96-98`](../supabase/migrations/0003_rls.sql#L96)).
- Delete the workspace: policy `workspaces_owner_delete`, which checks the stricter `is_workspace_owner()` ([`0003:100-101`](../supabase/migrations/0003_rls.sql#L100)).
- Manage `workspace_members`: policy `ws_members_admin_write` ([`0003:106-108`](../supabase/migrations/0003_rls.sql#L106)).
- Manage boards: policy `boards_admin_write` ([`0003:118-127`](../supabase/migrations/0003_rls.sql#L118)).

The server actions that implement these operations live in [`actions/workspaces.ts`](../actions/workspaces.ts) and [`actions/workspace-members.ts`](../actions/workspace-members.ts).

## What members can do

A workspace member can see the workspace itself, its full member list, and any board with `visibility = 'workspace'` (board SELECT policy [`0003:111-116`](../supabase/migrations/0003_rls.sql#L111)). They cannot see private boards unless explicitly added to `board_members`.

Crucially, thanks to migration `0048`, members can also create, edit and delete lists and cards on those workspace-visible boards — they do not need to be in `board_members` to write. They cannot, however, rename, archive or delete the board itself, or modify its membership.

There is no role gate on the `/w/[workspaceId]/settings` page; any workspace member can navigate to it and see the member list. Write operations on that page (renaming the workspace, inviting people) are blocked at the RLS layer rather than at the UI layer.

## What members cannot do

A workspace member cannot:

- Update or delete the workspace (`workspaces_owner_update`, `workspaces_owner_delete`).
- Invite, remove or re-role other members (`ws_members_admin_write`).
- Create or delete boards (`boards_admin_write` requires `is_board_admin` or `is_workspace_admin`).
- Write to a `private` board they have not been added to.

An admin can do everything a member can do, plus everything in the previous section, except deleting the workspace — that is reserved to the owner.

## Visibility — who can see a workspace?

Non-members cannot see workspaces. The only SELECT policies are `workspaces_member_select` (which requires `is_workspace_member`) and `workspaces_owner_select` (which requires `owner_id = auth.uid()`). The `/w/[workspaceId]/layout.tsx` server component reads the workspace through RLS-gated Drizzle queries, so if a member's row is removed, the next request returns no row and the layout redirects them to `/?notice=removed`.

The `workspace_members` table is also added to the Supabase realtime publication ([`0076_workspace_members_realtime.sql`](../supabase/migrations/0076_workspace_members_realtime.sql)), so when membership changes the workspace switcher in the nav updates immediately on every connected client.

## Creation and bootstrap

Any authenticated user can create a workspace. The `workspaces_self_insert` policy permits INSERT when `owner_id = auth.uid()` ([`0004:7-8`](../supabase/migrations/0004_workspaces_insert.sql#L7)).

Bootstrapping the owner's membership is handled by a special one-time policy, `ws_members_owner_bootstrap` ([`0004:23-31`](../supabase/migrations/0004_workspaces_insert.sql#L23)), which allows the workspace's `owner_id` to insert their own row at `role = 'owner'` before `is_workspace_admin()` would otherwise return true. All subsequent membership inserts go through the regular `ws_members_admin_write` policy.

The server action in [`actions/workspaces.ts:28-50`](../actions/workspaces.ts#L28) wraps these three steps atomically: insert the workspace, insert the creator at role `owner` via the bootstrap policy, and insert any pre-invited members via the normal admin-write path.

Migration `0050_workspace_auto_assign_creator.sql` adds an opt-in boolean `auto_assign_creator` to `workspaces`. When set, creating a card on any board in the workspace automatically inserts the creator into `card_members`. This is a workspace-level convenience setting, not a role distinction.

## The two structural rules in detail

**`0048_workspace_writes_visible_boards`.** Before this migration, `visibility = 'workspace'` only granted SELECT, so a freshly created workspace-visible board was read-only to anyone who hadn't been added as a board member — including the workspace admins who had created it from another workspace context. The migration replaces six policies (`lists_member_insert`, `lists_member_write`, `lists_member_delete`, `cards_member_insert`, `cards_member_write`, `cards_member_delete`) with versions that permit the action if **either** the user is in `board_members` **or** the board is workspace-visible and the user is a workspace member.

**`0063_board_member_implies_workspace_member`.** Before this migration, inviting an outside user directly to a board left them without a `workspace_members` row. Two things broke as a result: the inbox notification's actor profile couldn't be resolved because `profiles_shared_workspace_select` requires a shared workspace; and the workspace never appeared in the user's workspace switcher. The fix is a SECURITY DEFINER `AFTER INSERT` trigger on `board_members` that idempotently inserts a `workspace_members` row at `role = 'member'`. A migration-time backfill applied the same rule to all pre-existing board memberships.

## Performance and speed improvements (ordered by expected impact)

| # | Improvement | Why it helps | Where to act |
|---|---|---|---|
| 1 | Mark `is_workspace_admin()`, `is_workspace_owner()`, `is_workspace_member()` as `STABLE PARALLEL SAFE` and route every RLS policy through them instead of inlining `EXISTS (select 1 from workspace_members …)` subqueries | These helpers are hit on virtually every read in the system. `STABLE` lets Postgres cache the result within a query plan instead of re-running the EXISTS per row, which is the dominant cost on large boards. | [`0003_rls.sql`](../supabase/migrations/0003_rls.sql), grep for inline `workspace_members` EXISTS subqueries and replace |
| 2 | Verify and (if missing) add composite index `workspace_members(user_id, workspace_id) INCLUDE (role)` | Every workspace-scoped policy in the system probes this table by `user_id`. An INCLUDE on `role` makes the helper functions index-only. | New migration; check current indexes first |
| 3 | Collapse `workspace-snapshot.ts` into a single CTE-based query | The snapshot is the entry point for the workspace home and currently issues several sequential queries (workspaces, members, boards, favorites). One CTE returns everything in one round-trip. | [`lib/queries/workspace-snapshot.ts`](../lib/queries/workspace-snapshot.ts) |
| 4 | Use Next.js Server Component caching (`use cache` + `cacheTag('workspace:'+id)`) for the workspace shell | The workspace switcher and sidebar re-render on every navigation; tagging them lets `updateTag` invalidate only when membership changes. | `app/(app)/w/[workspaceId]/layout.tsx`, follow the Next.js 16 Cache Components pattern |
| 5 | Make the `0063` trigger conditional on workspace existence | The trigger fires on every `board_members` INSERT including bulk seeding; a cheap `WHEN (NOT EXISTS …)` guard avoids the SECURITY DEFINER path entirely when the row would no-op. | [`0063_board_member_implies_workspace_member.sql`](../supabase/migrations/0063_board_member_implies_workspace_member.sql) |

---

# Part 3 — Boards, Lists, Cards and the Kanban Surface

This is the largest functional area of the application: boards contain lists, lists contain cards, and cards have members, labels, checklists, comments, attachments, watchers, links, components and a full activity history. The vast majority of day-to-day work happens here.

## The roles

The board role enum, from [`0001_init.sql:29`](../supabase/migrations/0001_init.sql#L29):

```sql
create type public.board_role as enum ('admin','member','observer');
```

`board_members.role` defaults to `'member'`. When a user creates a board, the server action at [`actions/boards.ts:54`](../actions/boards.ts#L54) inserts them as `admin`.

## What a board admin can do

A board admin has effectively unlimited authority over the board. They can:

- Rename the board, change its visibility (private vs workspace), archive or restore it, and delete it. These operations all go through the `boards_admin_write` policy at [`0003:122-129`](../supabase/migrations/0003_rls.sql#L122).
- Invite users to the board, change their role, or remove them. Policy `board_members_admin_write` at [`0003:143-153`](../supabase/migrations/0003_rls.sql#L143).
- Create, rename, reorder, archive or delete lists, including setting WIP limits and marking a list as the canonical "status column" for a particular workflow state. The status-column constraint is enforced by [`0054_unique_status_list_per_board.sql`](../supabase/migrations/0054_unique_status_list_per_board.sql), which ensures only one list per board carries any given status kind.
- Create, edit, move, archive and delete cards, including all card fields (title, description, priority, type, story points, dates, cover image, owner, members, labels).
- Create comments, edit their own, and additionally resolve or delete *anyone's* thread. The admin path was added in [`0075_comment_threads_resolution.sql:18-36`](../supabase/migrations/0075_comment_threads_resolution.sql#L18) for resolution, and exists in the original [`0013_comments.sql:52-58`](../supabase/migrations/0013_comments.sql#L52) for deletion.
- Upload attachments and delete anyone's attachments ([`0014_attachments.sql:45-51`](../supabase/migrations/0014_attachments.sql#L45)).
- Create, edit and tick checklists via `is_board_writer()` from [`0049_board_writer_helper.sql`](../supabase/migrations/0049_board_writer_helper.sql).
- Watch or unwatch cards and favorite the board.
- Create and delete board-level components and attach them to cards ([`0031_components.sql:51-66`](../supabase/migrations/0031_components.sql#L51)).

## What a regular board member can do

A board member can do everything an admin can do *to the contents of the board* — they have full write access to lists, cards, labels, members, comments (their own), attachments (their own), checklists, watchers and favorites. They differ from admins on a few specific points:

- They cannot rename, archive, delete or re-visibilify the board itself. `boards_admin_write` checks `is_board_admin()`, which a member does not satisfy.
- They cannot invite or remove board members.
- They cannot resolve or delete other users' comments. Comments can only be modified by the author or a board admin ([`0075:18`](../supabase/migrations/0075_comment_threads_resolution.sql#L18)).
- They cannot delete other users' attachments — only the uploader or a board admin can ([`0014:45`](../supabase/migrations/0014_attachments.sql#L45)).
- They cannot create or delete board-level components ([`0031:51`](../supabase/migrations/0031_components.sql#L51)).

A subtle exception applies to changing a card's owner. The trigger `enforce_card_owner_change_policy` (final form in [`0085_fix_owner_policy_ambiguity.sql`](../supabase/migrations/0085_fix_owner_policy_ambiguity.sql)) lets a regular member **claim** an unowned card — that is, change `owner_id` from `NULL` to themselves. They cannot, however, reassign an owned card to someone else; only admins can do that.

## What an observer can do

The `observer` role was on the enum from the start, but for many migrations the write policies only checked board membership and not role, which meant observers could in practice write to cards. [`0067_observer_readonly.sql`](../supabase/migrations/0067_observer_readonly.sql) closed this hole comprehensively. Every write policy on `lists`, `cards`, `comments`, `attachments`, `checklist_items`, `card_members`, `card_labels`, `card_links` and `card_components` was rewritten to require `role in ('admin','member')` (or the workspace-visibility path).

After `0067`, observers can:

- SELECT everything visible to board members — they see the full board exactly as a member would.
- Watch or unwatch any card ([`0024_watchers.sql:34`](../supabase/migrations/0024_watchers.sql#L34) — the watcher policy was deliberately left checking only board membership, not role, so observers can subscribe to changes).
- Favorite the board ([`0042_board_favorites.sql:27`](../supabase/migrations/0042_board_favorites.sql#L27) — same shape as watchers).

They cannot write anything else: no list operations, no card operations, no comments, no attachments, no checklist updates. Trying to do so returns an empty result set or a policy violation depending on the operation.

## The card owner policy in detail

The card owner trigger handles transitions of `cards.owner_id`. Its logic, as fixed in [`0085`](../supabase/migrations/0085_fix_owner_policy_ambiguity.sql):

| Actor | Allowed transition |
|---|---|
| Board admin OR workspace owner/admin | Any → any (full reassignment authority) |
| The current owner | Can relinquish (set to `null` or another eligible user) |
| Any writable member, on an unowned card | Can set `owner_id` to themselves only |
| Observer or non-member | Always blocked |

In all cases the new owner must themselves be a board member or, for workspace-visible boards, a workspace member. The server action [`actions/cards.ts:209-289`](../actions/cards.ts#L209) mirrors the trigger logic so failures surface as helpful errors rather than raw RLS rejections. Migration `0081` introduced the original rule and `0085` fixed a variable-naming bug that produced "column reference is ambiguous" on every owner change.

## Workspace members without a board membership row

The behaviour here depends on the board's `visibility`:

- **Workspace-visible boards** are readable by every workspace member, and as of `0048` they are also fully writable to lists and cards. After `0067` this workspace-member write path is preserved explicitly alongside the role-based path, so workspace-visible boards behave consistently regardless of whether you are in `board_members` or only `workspace_members`.
- **Private boards** are invisible to anyone not in `board_members`. The board, its lists, its cards, its comments — nothing returns. Adding any user to `board_members` automatically lifts them into `workspace_members` at `role = 'member'` via the `0063` trigger, so the trick of inviting an outsider directly to a board still gives them workspace access.

## Non-workspace members

A user who is not in the workspace at all sees nothing. All workspace-scoped SELECT policies fail, so the database returns empty result sets — not 403 errors. The UI handles this as "you don't have access" or by redirecting away.

## Performance and speed improvements (ordered by expected impact)

| # | Improvement | Why it helps | Where to act |
|---|---|---|---|
| 1 | Add partial index `cards(board_id, list_id, position) WHERE archived = false` | The board view is the hottest read path in the application and currently relies on a non-partial `cards(board_id)` index that includes archived rows. A partial covering index removes the filter step and shrinks the index by an order of magnitude. | New migration |
| 2 | Parallelise the queries inside `board-snapshot.ts` with `Promise.all` | The snapshot currently issues board, lists, cards, labels, members, watchers in series. Most of these are independent and can run concurrently, cutting total latency to the slowest single query. | [`lib/queries/board-snapshot.ts`](../lib/queries/board-snapshot.ts) |
| 3 | Extract the `boards_select` policy's two-branch EXISTS into a `STABLE` SECURITY DEFINER helper `can_read_board(board_id)` | The policy is evaluated on every list, card, comment, attachment and activity row; the same subquery runs many times per page. A cached helper lets Postgres reuse the result. | [`0003_rls.sql:111-116`](../supabase/migrations/0003_rls.sql#L111) and [`0048`](../supabase/migrations/0048_workspace_writes_visible_boards.sql) policies |
| 4 | Add composite index `card_members(user_id, card_id)` and `card_members(card_id, user_id) INCLUDE (added_at)` | These two indexes cover both directions: "my cards" (`me-cards.ts`) and "who is on this card" (board snapshot, workload). | New migration |
| 5 | Exclude the generated `tsv` column from default card SELECTs | `cards.tsv` is a stored tsvector (`0017`); when actions and queries select `*` they pull the vector across the wire on every read. Explicit column lists in Drizzle avoid it. | [`lib/queries/cards.ts`](../lib/queries/cards.ts), [`lib/queries/board-snapshot.ts`](../lib/queries/board-snapshot.ts) |
| 6 | Memoise the board-membership check for the duration of a server action | Several action handlers run their own `select … from board_members where user_id = auth.uid()` before delegating to RLS. One memoised lookup per request would remove the duplicate. | `actions/boards.ts`, `actions/lists.ts`, `actions/cards.ts` — wrap with `React.cache` |
| 7 | Bundle the realtime publication. `0064`, `0076`, `0077`, `0092` each `ALTER PUBLICATION` separately. The publication is rebuilt on every alter; flapping during a migration. Consolidate. | Maintenance, not runtime — lowest priority. | Migration cleanup |

---

# Part 4 — Roadmap, Sprints, Epics, Milestones, Versions

The roadmap surface shares the same underlying card table as the kanban board: a card on a board is also a bar on the roadmap. On top of the cards table, the system adds card types (story, task, subtask, bug, **epic**), sprints, milestones, versions, and a few timeline-specific columns (`start_date`, `target_date`, `roadmap_order`).

## The data model

Cards carry a `type` enum (`epic | story | task | subtask | bug`, [`0018:3`](../supabase/migrations/0018_card_types.sql#L3)). They also have a self-referential `parent_card_id` that supports nested hierarchies up to ten levels deep (a depth guard is enforced by the `cards_validate_parent` trigger), so a story can contain subtasks and an epic can contain stories.

Sprints are workspace-scoped (`planned`, `active`, `completed`) and a unique index ensures only one active sprint per workspace ([`0020:17`](../supabase/migrations/0020_sprints.sql#L17)). A card's `sprint_id` is nullable.

Versions are also workspace-scoped (`unreleased`, `released`, `archived`). Cards link to versions through a `card_versions(kind = 'affects' | 'fixes')` junction defined in [`0032:2-24`](../supabase/migrations/0032_versions.sql#L2).

Milestones are first-class workspace rows, optionally scoped to a single board ([`0095:1-16`](../supabase/migrations/0095_milestones.sql#L1)).

The roadmap-specific card columns — `start_date` and `target_date` ([`0033:5`](../supabase/migrations/0033_card_roadmap_dates.sql#L5)) and `roadmap_order` for manual row ordering ([`0046:6`](../supabase/migrations/0046_roadmap_order.sql#L6)) — are stored on the cards table itself.

## Workspace owners and admins on the roadmap

Workspace owners and admins have complete authority on the roadmap. They can:

- Create, edit, start, complete and delete sprints. The application-layer check at [`actions/sprints.ts:57`](../actions/sprints.ts#L57) requires `role in ('owner','admin')`, and the RLS policy `sprints_admin_write` at [`0020:61`](../supabase/migrations/0020_sprints.sql#L61) enforces the same at the database.
- Assign a card to a sprint or change which sprint it is in. This is **exclusive** to workspace owners and admins — see the sprint-change policy section below.
- Create, update and delete milestones ([`0095:42`](../supabase/migrations/0095_milestones.sql#L42)) and versions ([`0032:58`](../supabase/migrations/0032_versions.sql#L58)).
- Schedule any card on the timeline by setting its `start_date` and `target_date`.
- Manually reorder cards on the roadmap by updating `roadmap_order`.
- Link a card as a child of an epic by setting `parent_card_id`.
- Move an epic from one board to another by updating `board_id` (only constrained by board write RLS on both source and destination).

## Board members ("writers") on the roadmap

Board members can do most card-level roadmap operations, but they hit a hard wall at sprint management:

- They can schedule cards on the roadmap by setting `start_date` / `target_date`. The standard `cards_member_write` policy (final form at [`0067:112`](../supabase/migrations/0067_observer_readonly.sql#L112)) covers this.
- They can reorder cards on the roadmap by updating `roadmap_order`.
- They can link cards as children of epics — the epic co-location trigger will automatically move the child to the epic's board if needed.
- They can attach versions to cards (`card_versions_member_write` lets any workspace member do this — [`0032:76`](../supabase/migrations/0032_versions.sql#L76)).
- They **cannot** create or manage sprints. Both the application layer and the database deny them.
- They **cannot** change a card's sprint assignment — this is the surprising part, covered below.
- They **cannot** create or manage milestones or versions; those are workspace-admin gated.

## Observers on the roadmap

Observers can read all roadmap data — every card field, every sprint, every milestone, every version. They cannot write any of it. The `cards_member_write` policy from `0067` explicitly excludes them from card mutations of any kind.

## The sprint-change policy

This is the trap that often surprises board admins. Even if you are an admin of the board, changing a card's `sprint_id` is gated to **workspace** owners and admins, not board admins.

The trigger was introduced in [`0082_enforce_card_sprint_change_policy.sql`](../supabase/migrations/0082_enforce_card_sprint_change_policy.sql) and bug-fixed in [`0083_fix_sprint_change_policy_ambiguity.sql`](../supabase/migrations/0083_fix_sprint_change_policy_ambiguity.sql) (the original version shadowed a local variable with a column of the same name, producing "column reference is ambiguous" on every sprint change — `0083` rewrote it with underscored locals; semantics are identical).

The trigger fires `BEFORE UPDATE OF sprint_id` and enforces three checks:

1. `auth.uid()` must be non-null — the operation must come from an authenticated user, not the service role at idle.
2. The user must have `role in ('owner', 'admin')` in the card's workspace ([`0083:27-33`](../supabase/migrations/0083_fix_sprint_change_policy_ambiguity.sql#L27)). This explicitly excludes board admins who are not also workspace admins. Writers and observers are obviously excluded too.
3. If the new sprint is not null, the sprint's `workspace_id` must match the card's workspace ([`0083:36-44`](../supabase/migrations/0083_fix_sprint_change_policy_ambiguity.sql#L36)) — no cross-workspace assignment.

There is no condition on the sprint's state, so assigning a card to a `completed` sprint is allowed (sometimes useful for retroactive attribution).

## Epic constraints

Three migrations ([`0051`](../supabase/migrations/0051_epic_constraints.sql), [`0052`](../supabase/migrations/0052_co_locate_existing_children.sql), [`0053`](../supabase/migrations/0053_clear_nested_epic_parents.sql)) shape what an epic can and cannot do.

**Epics cannot nest under other epics.** The trigger `cards_validate_epic_parent_biu` ([`0051:22`](../supabase/migrations/0051_epic_constraints.sql#L22)) fires before any insert or update that touches `parent_card_id` or `type` and raises an exception if a card of type `epic` would end up under a parent of type `epic`. A complementary trigger, `cards_reject_epic_with_epic_children_bu`, blocks the workaround of flipping an existing card to `epic` when it already has epic children. Migration `0053` performed a one-time backfill that set `parent_card_id = NULL` on any epic that was previously nested.

**Children of an epic must live on the epic's board.** The trigger `cards_co_locate_with_epic_parent_biu` ([`0051:50`](../supabase/migrations/0051_epic_constraints.sql#L50)) silently rewrites a child's `board_id` to match the parent epic's board whenever the parent is set. There is no error message — the relocation is automatic. Migration `0052` backfilled this rule for existing cross-board children.

## Date rollups

When you set dates on the children of an epic, the epic's own `start_date` and `target_date` automatically expand to cover them. This is implemented by `cards_rollup_epic_dates`, a SECURITY DEFINER trigger defined in [`0061_epic_date_rollup.sql`](../supabase/migrations/0061_epic_date_rollup.sql).

The trigger fires whenever a child's `start_date`, `target_date`, `parent_card_id` or `archived` flag changes, and on inserts and deletes. It recomputes the parent's span as the minimum of children's `start_date` and the maximum of children's `target_date`, restricted to non-archived children.

The important caveat is that the rollup is **expansion-only**: the CASE logic at [`0061:45-54`](../supabase/migrations/0061_epic_date_rollup.sql#L45) only updates the epic if the child-driven value would push the epic earlier (for start) or later (for target) than its current value. A manually set epic span that is wider than the children is preserved. But if you try to *narrow* an epic to be tighter than its children, the trigger will silently re-expand it on the very next child date change. There is no UI opt-out and no flag to disable this behaviour per card or per board.

## Subtask autocomplete

When you tick the last open subtask of a parent, the parent is automatically marked complete. This is implemented by `cards_autocomplete_parent_on_subtask` in [`0088_subtask_autocomplete_parent.sql`](../supabase/migrations/0088_subtask_autocomplete_parent.sql).

The trigger fires after a card's `completed_at` flips from `NULL` to non-null, counts open versus total non-archived children, and if all children are complete it stamps the parent's `completed_at = now()` ([`0088:60`](../supabase/migrations/0088_subtask_autocomplete_parent.sql#L60)). It runs as SECURITY DEFINER and bypasses RLS, so it can complete a card even when the user who finished the last subtask doesn't directly have UPDATE rights on the parent.

There is no opt-out. There is also no inverse: un-completing a subtask does *not* un-complete the parent — that case was explicitly left out ([`0088:10`](../supabase/migrations/0088_subtask_autocomplete_parent.sql#L10)).

## Performance and speed improvements (ordered by expected impact)

| # | Improvement | Why it helps | Where to act |
|---|---|---|---|
| 1 | Convert `cards_rollup_epic_dates` from `AFTER ROW` to `AFTER STATEMENT` with a per-statement transition table | Bulk operations (CSV import, "move all to next sprint", child reordering) fire the row trigger once per child, which in turn does an `UPDATE cards` on the parent — quadratic in the number of children. A statement trigger does the rollup once. | [`0061_epic_date_rollup.sql`](../supabase/migrations/0061_epic_date_rollup.sql) |
| 2 | Add partial index `cards(parent_card_id, archived) WHERE parent_card_id IS NOT NULL AND archived = false` | The rollup trigger and `epic-children.ts` both scan all non-archived children of a parent. A partial index on parented, non-archived cards is small enough to fit in cache. | New migration |
| 3 | Short-circuit `cards_record_field_history` and the rollup when nothing actually changed | The history trigger from `0091` has 12 IF branches that all run on every UPDATE, and the rollup re-runs even when `parent_card_id` is the only changed field. Add an early `RETURN NULL` when none of the watched columns appear in `TG_ARGV` or the `UPDATE OF` list. | [`0091:33`](../supabase/migrations/0091_card_field_history.sql#L33), [`0061`](../supabase/migrations/0061_epic_date_rollup.sql) |
| 4 | Index `cards(sprint_id) WHERE sprint_id IS NOT NULL` and `card_sprint_history(card_id, started_at desc)` | Sprint reports and velocity queries (`sprints-stats.ts`, `sprint-report.ts`) scan `card_sprint_history` by card; the partial index makes "cards in this sprint" sub-millisecond. | New migration |
| 5 | Replace the recursive epic-children fetch with an iterative CTE bounded by depth | If `epic-children.ts` uses a naive recursive walk it can hit the depth-10 cap repeatedly on large epics; an explicit `WITH RECURSIVE … WHERE depth < 10` is faster and bounded. | [`lib/queries/epic-children.ts`](../lib/queries/epic-children.ts) |
| 6 | Make the sprint-change trigger skip when `old.sprint_id IS NOT DISTINCT FROM new.sprint_id` before doing the role lookup | The check is already implicit in some paths but the trigger still hits `workspace_members` on a no-op update from the optimistic-UI re-render flow. | [`0083_fix_sprint_change_policy_ambiguity.sql`](../supabase/migrations/0083_fix_sprint_change_policy_ambiguity.sql) |

---

# Part 5 — Dashboards, Gadgets, Workload and Worklogs

Dashboards are user-built homepages composed of gadgets that read from the rest of the system. Workload is a per-user capacity / assignment view. Worklogs are time entries logged against cards.

## The dashboard role model

Two tables back this surface. `dashboards` ([`0034_dashboards.sql`](../supabase/migrations/0034_dashboards.sql)) stores `owner_id` directly on the row — there is no `role` column on the table itself, so ownership is implicit. The ACL table `dashboard_members` was added later in [`0068_dashboard_share.sql`](../supabase/migrations/0068_dashboard_share.sql):

```sql
create type public.dashboard_role as enum ('viewer','editor');
create table public.dashboard_members (
  dashboard_id uuid,
  user_id uuid,
  role public.dashboard_role not null default 'viewer',
  added_by uuid,
  …
);
```

So in practice there are four kinds of access to a dashboard:

- **Owner** — the user in `dashboards.owner_id`. Has full control.
- **Editor** — has an `dashboard_members` row at `role = 'editor'`. Can rename the dashboard and manage its gadgets, but cannot share it with new users or delete it.
- **Viewer** — has a `dashboard_members` row at `role = 'viewer'`. Read-only.
- **Implicit workspace viewer** — any workspace member, on dashboards that are workspace-scoped, gets read access without an ACL row.

All enforcement is RLS-only. The server actions in [`actions/dashboards.ts`](../actions/dashboards.ts), [`actions/dashboard-members.ts`](../actions/dashboard-members.ts) and [`actions/gadgets.ts`](../actions/gadgets.ts) simply forward the user's JWT to the database; no extra application-layer role check exists.

## What each dashboard role can do

| Operation | Owner | Editor | Viewer | Implicit ws-viewer |
|---|---|---|---|---|
| Create a new dashboard | ✅ (INSERT policy requires `owner_id = auth.uid()`) | n/a | n/a | ✅ for workspace-scoped |
| Rename the dashboard | ✅ | ✅ (`dashboards_owner_or_editor_update` from `0068`) | ❌ | ❌ |
| Delete the dashboard | ✅ (`dashboards_owner_delete`) | ❌ | ❌ | ❌ |
| Add a member (share) | ✅ (`dashboard_members_owner_write`) | ❌ | ❌ | ❌ |
| Change a member's role | ✅ | ❌ | ❌ | ❌ |
| Remove a member | ✅ | ❌ | ❌ | ❌ |
| Add, configure, reorder or delete gadgets | ✅ | ✅ (`gadgets_owner_or_editor_write` from `0068`) | ❌ | ❌ |
| Read the dashboard and its gadgets | ✅ | ✅ | ✅ | ✅ (workspace-scope only) |

There is no public-link sharing mechanism. Every share is a per-user invitation that the owner sends through the `shareDashboard` action ([`actions/dashboard-members.ts:60`](../actions/dashboard-members.ts#L60)), which inserts a `dashboard_members` row.

## Workload visibility

The workload report at `/workload` shows who is assigned what across the boards the viewer can see. It is built by [`lib/queries/workload.ts`](../lib/queries/workload.ts), which runs under the caller's RLS token and joins `card_members` and `cards`.

Two visibility gaps existed before [`0074_workload_visibility_fixes.sql`](../supabase/migrations/0074_workload_visibility_fixes.sql):

1. `card_members_select` only granted access to users who were in `board_members`. A user who could see a workspace-visible board through workspace membership alone could see the cards but not the `card_members` rows — their collaborators' assignments simply did not appear.
2. `profiles_self_select` required a shared `workspace_members` row. Two users who shared a cross-workspace board but no workspace overlap could not read each other's `display_name`, so the workload lane fell back to "Unknown".

`0074` added a workspace-visibility disjunct to `card_members_select` and a "share a board" disjunct to `profiles_self_select`. After the fix, the rule is simple to state: **user X can see user Y's workload rows if and only if X has access to at least one board on which Y has assignments**. There is no per-user toggle to hide your workload — visibility is a function of board membership.

## Worklogs

Worklogs let users log time against a card. The relevant policies are in [`0028_worklogs.sql`](../supabase/migrations/0028_worklogs.sql).

To **log time**, the caller must satisfy `worklogs_self_write`: they must be the `user_id` on the row (`user_id = auth.uid()`) and must be an explicit `board_members` row on the card's board. Workspace membership alone is not enough. Importantly, there is **no card-level restriction** — any board member can log time on any card in that board, not just cards they own or are assigned to.

To **edit or delete a worklog**, only the original author can act. `worklogs_self_update` and `worklogs_self_delete` both require `user_id = auth.uid()` and there is **no admin override** anywhere — not at the RLS layer, not in `actions/worklogs.ts`. This means stale worklogs left behind by someone who has since left the organization can only be removed via direct database access using the service-role key.

Reading worklogs requires board membership (`worklogs_select`).

## Edge cases worth knowing

- **The `dashboard_members` recursion bug.** When `0068` introduced sharing, its `dashboard_members_select` policy contained a self-referential `EXISTS` subquery: to decide whether a user could read a row in `dashboard_members`, Postgres asked whether that user was in `dashboard_members`, which re-fired the same policy and produced infinite recursion. The same broke `INSERT … RETURNING` on `dashboards` because the implied SELECT triggered the recursive `dashboards_select` policy. [`0093_fix_dashboard_members_recursion.sql`](../supabase/migrations/0093_fix_dashboard_members_recursion.sql) replaces the recursion with two SECURITY DEFINER helpers — `is_dashboard_owner()` and `is_workspace_dashboard()` — that query the underlying `dashboards` row directly. The resulting access rule is: a user can see `dashboard_members` rows if they are the row's own user, the dashboard owner, or a workspace member of a workspace-scoped dashboard.
- **`me-week`, `me-cards` and the other `me-*` queries are strictly per-self.** Every query in [`lib/queries/me-week.ts`](../lib/queries/me-week.ts) and [`lib/queries/me-cards.ts`](../lib/queries/me-cards.ts) resolves the caller's UUID via `meId(token)` and hard-codes it into every WHERE clause (`eq(cards.ownerId, userId)`, `eq(cardMembers.userId, userId)`). There is no `targetUserId` parameter, no admin path, no escape hatch. Cross-user reads are structurally impossible from these entry points.

## Performance and speed improvements (ordered by expected impact)

| # | Improvement | Why it helps | Where to act |
|---|---|---|---|
| 1 | Pre-aggregate workload into a `workload_daily` materialised view refreshed every few minutes | `lib/queries/workload.ts` joins `card_members`, `cards`, `boards` and `profiles` and groups by user-day; on a busy workspace the query is the slowest read in the app. A materialised view turns it into a single indexed scan. | [`lib/queries/workload.ts`](../lib/queries/workload.ts) plus new migration |
| 2 | Add indexes `worklogs(card_id, user_id)` and `worklogs(user_id, started_at desc)` | These cover both "show me time logged on this card" and "my week of worklogs". Currently the worklog timeline does a sort over an unindexed range. | New migration |
| 3 | Stream gadgets independently using React Server Components and Suspense boundaries | The dashboard page currently waits for every gadget query to finish before sending HTML; streaming lets each gadget arrive when its data is ready, cutting perceived load time in half. | `app/(app)/dashboards/[id]/page.tsx` |
| 4 | Cache the dashboard shell with `use cache` + `cacheTag('dashboard:'+id)` and invalidate via `updateTag` on mutation | Dashboard metadata changes rarely; gadget data changes constantly. Tagging the shell separately from gadget data keeps the shell warm. | Same page, Next.js 16 Cache Components |
| 5 | Replace the two SECURITY DEFINER helpers from `0093` with a single helper that returns `(is_owner, is_workspace_visible)` | The current implementation calls two separate functions per RLS evaluation. Combining them halves the function-call overhead on the recursion-prone path. | [`0093_fix_dashboard_members_recursion.sql`](../supabase/migrations/0093_fix_dashboard_members_recursion.sql) |
| 6 | Verify and (if missing) index `gadgets(dashboard_id, position)` | The dashboard render orders gadgets by position; an index avoids the per-render sort. | New migration |

---

# Part 6 — Cross-cutting Systems: Notifications, SLA, Activity, Search, Rules, Card History, Inbox

This part covers the systems that span the whole application: how users get notified, how stale cards are tracked, how the activity feed is generated, how search works, what the automation engine can do, what is recorded in card history, and how the personal inbox is built.

## Notifications

The `public.notifications` table is keyed on `recipient_user_id` — every row belongs to exactly one user. The allowed notification kinds were defined by a CHECK constraint in [`0023:4-11`](../supabase/migrations/0023_notifications.sql#L4-L11) and extended over time by [`0070`](../supabase/migrations/0070_more_notif_kinds.sql) (link and sprint-change notifications), [`0080`](../supabase/migrations/0080_notifications_allow_owner_kinds.sql) (owner-change kinds), and [`0087`](../supabase/migrations/0087_completion_notification.sql) (completion).

Access is strictly recipient-only at the RLS layer ([`0023:24-32`](../supabase/migrations/0023_notifications.sql#L24-L32)):

- Reading a notification requires `recipient_user_id = auth.uid()`. You can never see a notification that belongs to another user.
- Marking read or unread requires the same condition.
- Deleting a notification requires the same condition.
- **Inserting a notification has no user policy at all.** The comment at [`0023:34`](../supabase/migrations/0023_notifications.sql#L34) makes the design explicit: notifications are only ever created by SECURITY DEFINER trigger functions on other tables. A user cannot create a notification for anyone — not for themselves, not for someone else.

The server-action surface in [`actions/notifications.ts`](../actions/notifications.ts) is minimal: `markNotificationRead({id, read})` toggles `read_at`, and `markAllRead()` clears all the caller's unread rows. There is no create or delete action.

The notification engine deliberately suppresses self-notifications. The `emit_notification` function at [`0069:13-14`](../supabase/migrations/0069_emit_notification_honors_prefs.sql#L13-L14) short-circuits when the actor and recipient are the same user, so you never get notified about your own actions.

**User preferences.** Users can mute notifications per kind and per channel through [`actions/user-notification-prefs.ts`](../actions/user-notification-prefs.ts). The model is opt-out: if no row exists in `user_notification_prefs` for a given (user, kind, channel), the notification is delivered. A row with `enabled = false` mutes that combination. The relevant logic lives in `emit_notification` at [`0069:18-26`](../supabase/migrations/0069_emit_notification_honors_prefs.sql#L18-L26), which was rewritten precisely so that the toggles in `/settings/notifications` actually mute the in-app row instead of being decorative.

The daily email digest is a separate, global opt-in. It is stored on `profiles.email_digest_optin` ([`0090:13-14`](../supabase/migrations/0090_email_digest_prefs.sql#L13-L14)) rather than in `user_notification_prefs` because it spans all kinds. It defaults to **off**; users must explicitly enable it at `/settings/notifications`.

RLS on `user_notification_prefs` itself locks rows to the owner (`user_id = auth.uid()` at [`0026:10-11`](../supabase/migrations/0026_user_notification_prefs.sql#L10-L11)). Nobody can read or modify another user's preferences.

**The email path.** Two cron routes handle email delivery. The per-event sender at [`app/api/cron/send-emails/route.ts`](../app/api/cron/send-emails/route.ts) authenticates with `Authorization: Bearer ${CRON_SECRET}`, runs every five minutes per the comment, and waits at least 30 seconds before sending so the in-app bundle dedup has a chance to fold rapid-fire events into a single email. The daily digest at [`app/api/notifications/digest/route.ts`](../app/api/notifications/digest/route.ts) authenticates with the `x-cron-key` header, uses the **service-role** Supabase client to enumerate users who opted in, builds the digest by joining notifications and card titles, sends via Resend, and stamps `email_sent_at` on every included row so the per-event sender doesn't double-send. Neither route is reachable by an end user; both require server-side secrets.

## SLA

The SLA system tracks cards that sit too long without progress. A board can have one or more `sla_policies` rows, each with a `target_min` (target time in minutes) and an `applies_when` JSONB filter. When a card exceeds the target without being archived, a row is inserted into `card_sla` with `breached_at = now()`. When a previously breached card is archived, its row is updated with `resolved_at`.

Both tables are defined in [`0029_sla.sql`](../supabase/migrations/0029_sla.sql).

**Who can manage SLA policies.** [`0029:40-62`](../supabase/migrations/0029_sla.sql#L40-L62) makes the rule clear: any board member can read SLA policies, but writing them (create, update, delete) requires either being a **board admin** or being a workspace **owner or admin**. Regular board members and observers cannot manage SLAs. `card_sla` rows are readable by any board member, and there is no user write policy — only the SECURITY DEFINER scan function writes them.

**Who can trigger an SLA scan.** The `scan_board_sla(board_id)` function has two call paths, separated in [`0094_allow_service_role_sla_scan.sql`](../supabase/migrations/0094_allow_service_role_sla_scan.sql):

1. **The authenticated-user path.** Any board member can invoke the function via [`actions/sla.ts:82-96`](../actions/sla.ts#L82-L96) (`scanBoardSla`). The function checks board membership inside itself and raises `'forbidden'` for non-members ([`0094:13-17`](../supabase/migrations/0094_allow_service_role_sla_scan.sql#L13-L17)). This is what powers the manual "rescan" button on the board settings page.
2. **The service-role cron path.** When `auth.role() = 'service_role'`, the membership check is skipped ([`0094:12`](../supabase/migrations/0094_allow_service_role_sla_scan.sql#L12)). The cron route at [`app/api/sla/scan/route.ts`](../app/api/sla/scan/route.ts) authenticates with `Authorization: Bearer ${CRON_SECRET}` and connects to Supabase with `SUPABASE_SERVICE_ROLE_KEY`. This path is reserved for the scheduled background scan; an end user cannot reach it.

A non-board-member who knows a board's UUID still cannot run a scan — the function raises `'forbidden'` before doing any work.

## Activity feed

Every row in `public.activity` is written by a SECURITY DEFINER trigger somewhere in the system. The triggers live in [`0016_activity_triggers.sql`](../supabase/migrations/0016_activity_triggers.sql) and have been extended over time by [`0036_activity_dates.sql`](../supabase/migrations/0036_activity_dates.sql), [`0047_activity_roadmap_order.sql`](../supabase/migrations/0047_activity_roadmap_order.sql), [`0086_card_completion_activity.sql`](../supabase/migrations/0086_card_completion_activity.sql) and others.

The `activity` table has no user INSERT, UPDATE or DELETE policy — only the triggers can write. Activity is therefore immutable: **a user cannot create, edit or delete activity entries**, not even their own.

Read access mirrors card visibility. The `activity_select` policy at [`0015:15-24`](../supabase/migrations/0015_activity_table.sql#L15-L24) lets a user see a row if they are a `board_members` row on the activity's board, or if they are a workspace member and the board is workspace-visible. Migration `0078_activity_skip_missing_cards.sql` made the SELECT robust against deleted cards but did not change the access rule.

## Search

Card search is powered by Postgres full-text search on the generated `cards.tsv` column ([`0017_card_search.sql`](../supabase/migrations/0017_card_search.sql)). The query layer in [`lib/queries/search.ts`](../lib/queries/search.ts) runs `websearch_to_tsquery` joined to `cards` and `boards`, with no user-id filter in the SQL.

Result scoping is therefore done entirely by RLS on `cards` and `boards`: the query returns whatever rows the caller is allowed to see. In practice this means a user sees results **only from boards they can read** — either as a board member or as a workspace member of a workspace-visible board. No leakage of titles or descriptions from private boards is possible.

The server action at [`actions/search.ts:5-9`](../actions/search.ts#L5) only checks `requireUser()` before forwarding to the query.

## Automation rules

The rules engine, defined in [`0030_rules.sql`](../supabase/migrations/0030_rules.sql), stores per-board `rules` (trigger, conditions and actions as JSONB) and a per-run `rule_runs` ledger.

The policies at [`0030:32-55`](../supabase/migrations/0030_rules.sql#L32-L55) draw a sharp line. Reading rules and rule runs is open to any board member, but **only board admins** can insert, update or delete rules. Regular members and observers cannot create or edit rules. The `rule_runs` table has no user write policy at all — only the service-role engine writes runs, so users cannot retroactively forge a successful run or hide a failure.

The engine itself executes server-side under service-role credentials, so the privileges of the user who fired the trigger event do not constrain what the rule's actions can do.

## Card history

The system maintains a per-field audit log of card mutations in `card_field_history`, defined in [`0091_card_field_history.sql`](../supabase/migrations/0091_card_field_history.sql). A SECURITY DEFINER trigger fires `AFTER UPDATE` on `cards` and emits one row per changed scalar field, covering 12 tracked fields: title, priority, owner_id, start_date, target_date, due_date, completed_at, sprint_id, parent_card_id, type, story_points, estimate_min.

Read access mirrors card readability ([`0091:116-139`](../supabase/migrations/0091_card_field_history.sql#L116-L139)): a user can read the history of a card if and only if they can read the card itself. There is no INSERT, UPDATE or DELETE policy on `card_field_history` — only the trigger can write, and nothing else (including the user who made the change) can modify or remove an audit entry.

A separate, more specialised audit lives in `card_sprint_history` ([`0089_card_sprint_history.sql`](../supabase/migrations/0089_card_sprint_history.sql)), which records open/close windows for each sprint membership so velocity attribution remains accurate even if a card is moved back and forth. Migration [`0092_realtime_history_tables.sql`](../supabase/migrations/0092_realtime_history_tables.sql) adds both tables to the realtime publication. The same readability rule applies.

## Inbox

The personal inbox at `/inbox` is rendered from queries in [`lib/queries/me-inbox.ts`](../lib/queries/me-inbox.ts). Every function in that file resolves the caller's user ID from their JWT (`meId(token)`) and uses it directly in the WHERE clauses. There is no `userId` parameter on the public functions, so a client cannot request someone else's inbox. RLS on `notifications` would block cross-user reads anyway, but the API surface itself makes the request impossible to formulate. The same per-self pattern applies to `me-week`, `me-cards` and `me-sprints` queries.

## Summary

| Surface | Who can read | Who can write |
|---|---|---|
| Notifications | The recipient only | Only SECURITY DEFINER triggers; no user can create one |
| Notification preferences | Self only | Self only |
| Activity feed | Board member, or workspace member on workspace-visible boards | Only triggers; immutable to users |
| SLA policies | Any board member | Board admin OR workspace owner/admin |
| SLA scan | Any board member (via the function) OR service-role cron | Only the SECURITY DEFINER function |
| Automation rules | Any board member | Board admin only; `rule_runs` is service-role only |
| Card history | Anyone who can read the card | Only the trigger; users cannot edit or delete history |
| Search results | RLS-scoped to readable cards | Read-only |
| Inbox and `me-*` views | The caller, on their own data | Read-only |

## Performance and speed improvements (ordered by expected impact)

| # | Improvement | Why it helps | Where to act |
|---|---|---|---|
| 1 | Replace the per-watcher `LOOP … perform emit_notification(…)` in the link and sprint-change triggers with a single multi-row `INSERT … SELECT` | On cards with many watchers, the current loop does one statement per watcher. A set-based insert is one statement total and lets the planner batch the index updates. | [`0070_more_notif_kinds.sql:16-33`](../supabase/migrations/0070_more_notif_kinds.sql#L16) and the equivalent loops in [`0025_notify_triggers.sql`](../supabase/migrations/0025_notify_triggers.sql) |
| 2 | Partition `activity` and `card_field_history` by month | Both tables are append-only and grow without bound. Monthly partitioning lets old partitions be detached / archived, keeps current-partition indexes small, and accelerates the time-range scans that drive the activity feed and card history pane. | [`0015_activity_table.sql`](../supabase/migrations/0015_activity_table.sql), [`0091_card_field_history.sql`](../supabase/migrations/0091_card_field_history.sql) — new migration converts to partitioned table |
| 3 | Add `pg_trgm` GIN index on `cards.title` for the ILIKE fallback in `searchCardsForLink` | The picker query at [`lib/queries/search.ts:67`](../lib/queries/search.ts#L67) does `lower(c.title) like '%…%'` alongside the tsvector match. Without trigram support the ILIKE branch is a full table scan. | New migration |
| 4 | Make the SLA scan incremental | The current `scan_board_sla` re-evaluates every non-archived card against every enabled policy on every run. Tracking a `cards.last_sla_check_at` (or scanning by `cards.updated_at > last_run_at`) drops the cost from O(boards × cards × policies) to O(changes). | [`0094_allow_service_role_sla_scan.sql`](../supabase/migrations/0094_allow_service_role_sla_scan.sql) |
| 5 | Add covering index `notifications(recipient_user_id, created_at desc) INCLUDE (kind, related_card_id, related_board_id, read_at)` | The inbox query reads all of these columns; an INCLUDE index makes it index-only and removes the heap fetch per row. The existing `notifications(recipient_user_id, created_at desc)` index gets it part of the way. | New migration |
| 6 | Skip `cards_record_field_history` when none of the 12 tracked columns appears in the UPDATE | The trigger currently runs all 12 IF branches on every card UPDATE, including updates that touch only untracked fields (description, cover, position). A column-aware short-circuit at the top removes the overhead entirely for the common case. | [`0091_card_field_history.sql:33`](../supabase/migrations/0091_card_field_history.sql#L33) |
| 7 | Confirm and (if missing) tighten the partial index `notifications(recipient_user_id) WHERE read_at IS NULL` to also `INCLUDE (created_at)` | Used by the unread-badge query on every page load; current partial index exists ([`0023:20`](../supabase/migrations/0023_notifications.sql#L20)) but adding `created_at` makes the "newest unread" lookup index-only. | New migration |

---

# Appendix — Gaps and Anomalies Worth Flagging

The investigation surfaced several behaviours that are not obvious from the UI and may surprise users or operators:

- **The email domain allowlist is not active.** The migration `0056_auth_domain_allowlist.sql.disabled` defines a restriction to the `innovina.it` domain but its `.disabled` extension means it was never applied. Today any email domain can sign up.
- **There is no way for a user to delete their own account.** No server action, route or UI element exists.
- **Avatar upload is unimplemented.** The `profiles.avatar_url` column exists but no upload surface has been built.
- **Handles cannot be edited from the UI.** They are auto-assigned at signup and remain immutable thereafter.
- **Sprint changes require workspace owner/admin, not just board admin.** A board admin who is only a workspace `member` will silently fail to reassign cards to a different sprint — the trigger rejects it. This is easy to confuse because board admins can do everything else card-related.
- **Epic date rollups are expansion-only and trigger-driven.** Manually narrowing an epic span will be silently undone on the next child date change. There is no flag to opt out.
- **Subtask autocomplete cannot be turned off.** Completing the last subtask auto-completes the parent for every card in the system. Un-completing a subtask does **not** roll back the parent.
- **Worklog edit and delete have no admin override.** A user who has left the organisation leaves behind worklogs only they could have edited or removed. Only a service-role intervention against the database can clean them up.
- **Dashboard sharing has no public-link mode.** The owner must individually invite every viewer or editor.
