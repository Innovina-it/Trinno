# Role System

## Overview

The system uses three independent role tiers: workspace, board, and dashboard. Workspace roles govern coarse membership and structural operations (rename, delete, invite). Board roles govern per-board content write access and board administration. Dashboard roles govern per-dashboard sharing and gadget editing. No tier automatically inherits full rights from another; the inheritance rules are explicit and are described in the section below.

---

## Workspace roles

Defined in `lib/db/schema.ts:15` as `pgEnum("workspace_role", ["owner", "admin", "member"])`.

| Role | Can do | Can't do |
|---|---|---|
| owner | Rename workspace <!-- ref: supabase/migrations/0003_rls.sql:96 `workspaces_owner_update` `is_workspace_admin` includes owner --> ; delete workspace <!-- ref: supabase/migrations/0003_rls.sql:100 `workspaces_owner_delete` `is_workspace_owner` --> ; invite members at admin or member role <!-- ref: actions/workspace-members.ts:14 `inviteMemberImpl` --> ; change any non-owner member's role <!-- ref: actions/workspace-members.ts:43 `changeMemberRoleImpl` RLS `ws_members_admin_write` --> ; remove any non-owner member <!-- ref: actions/workspace-members.ts:57 --> ; manage workspace settings <!-- ref: supabase/migrations/0003_rls.sql:93 `is_workspace_admin` --> ; create boards <!-- ref: actions/boards.ts:35 `createBoardImpl`, RLS `boards_admin_write` allows `is_workspace_admin` --> ; archive any board <!-- ref: supabase/migrations/0003_rls.sql:123 `boards_admin_write` --> ; manage SLA policies on any board <!-- ref: supabase/migrations/0029_sla.sql:55 wm.role in ('owner','admin') --> | Manage billing (no billing layer exists in the codebase); be removed or have their own role changed via the UI (owner row is `disabled` in member-list) <!-- ref: components/workspace/member-list.tsx:44 --> |
| admin | Same as owner for: rename workspace, invite members, change non-owner roles, remove non-owner members, manage workspace settings, create boards, archive boards, manage SLAs on any board <!-- ref: supabase/migrations/0003_rls.sql:30-34 `is_workspace_admin` includes 'admin' --> | Delete workspace <!-- ref: supabase/migrations/0003_rls.sql:100-101 delete requires `is_workspace_owner` --> ; change an owner's role; manage billing |
| member | Read workspace and its visible boards; create cards and lists on `visibility = 'workspace'` boards <!-- ref: supabase/migrations/0067_observer_readonly.sql workspace path in every write policy --> ; invite/remove no one; no structural board changes | Rename or delete workspace; invite workspace members; manage workspace settings; archive boards; manage SLAs |

---

## Board roles

Defined in `lib/db/schema.ts:18` as `pgEnum("board_role", ["admin", "member", "observer"])`.

Board membership is separate from workspace membership. A board can be `private` (explicit members only) or `workspace` (all workspace members can read and write content; see inheritance section).

| Role | Can do | Can't do |
|---|---|---|
| admin | Create, edit, delete lists and cards <!-- ref: supabase/migrations/0067_observer_readonly.sql bm.role in ('admin','member') --> ; manage board members (invite, change role, remove) <!-- ref: supabase/migrations/0003_rls.sql:143-158 `board_members_admin_write` `is_board_admin` --> ; rename and archive board <!-- ref: supabase/migrations/0003_rls.sql:122-129 `boards_admin_write` `is_board_admin` --> ; manage SLA policies <!-- ref: supabase/migrations/0029_sla.sql:51 bm.role = 'admin' --> ; create and edit automation rules <!-- ref: supabase/migrations/0030_rules.sql:40-54 bm.role = 'admin' --> | Delete the workspace; manage workspace members |
| member | Create, edit, delete lists and cards <!-- ref: supabase/migrations/0067_observer_readonly.sql bm.role in ('admin','member') --> ; post comments <!-- ref: supabase/migrations/0067_observer_readonly.sql:99 bm.role in ('admin','member') --> ; add/remove attachments <!-- ref: supabase/migrations/0049_board_writer_helper.sql `attachments_member_insert/delete` --> | Manage board members; archive board; manage SLAs; manage automation rules |
| observer | Read all lists, cards, comments, attachments on the board | Write anything: all INSERT/UPDATE/DELETE write policies require role in ('admin','member') for the board_member path <!-- ref: supabase/migrations/0067_observer_readonly.sql --> |

---

## Dashboard roles

Defined in `lib/db/schema.ts` (added by `supabase/migrations/0068_dashboard_share.sql`) as `pgEnum("dashboard_role", ["viewer", "editor"])`. The dashboard owner is tracked in `dashboards.owner_id` and is not a row in `dashboard_members`; owner rights are checked separately in every policy.

| Role | Can do | Can't do |
|---|---|---|
| owner (implicit, not a `dashboard_role` value) | Create, rename, delete dashboard; share with others; add, edit, delete, reorder gadgets <!-- ref: supabase/migrations/0068_dashboard_share.sql `gadgets_owner_or_editor_write` owner path --> | N/A |
| editor | Rename dashboard <!-- ref: supabase/migrations/0068_dashboard_share.sql `dashboards_owner_or_editor_update` --> ; add, edit, delete, reorder gadgets <!-- ref: supabase/migrations/0068_dashboard_share.sql `gadgets_owner_or_editor_write` --> | Delete the dashboard <!-- ref: supabase/migrations/0034_dashboards.sql `dashboards_owner_delete` owner only --> ; add or remove share grants <!-- ref: supabase/migrations/0068_dashboard_share.sql `dashboard_members_owner_write` owner only --> |
| viewer | Read the dashboard and its gadgets | Edit any content; share; delete |

---

## Role inheritance

### Workspace role does not automatically grant board membership

Workspace `owner` and `admin` can write to any board (rename, archive, delete, manage board members) via the `boards_admin_write` and `board_members_admin_write` RLS policies, which check `is_workspace_admin` as an alternative to `is_board_admin` <!-- ref: supabase/migrations/0003_rls.sql:122-158 -->.

Workspace `member` can read and write card content (create/edit/delete lists, cards, comments, etc.) on boards with `visibility = 'workspace'`, without having an explicit `board_members` row <!-- ref: supabase/migrations/0067_observer_readonly.sql workspace-visible path in every write policy -->.

### Workspace admin on a private board they are not a member of

A workspace `admin` retains structural write rights on a private board (rename, archive, delete, manage board members) via `is_workspace_admin` <!-- ref: supabase/migrations/0003_rls.sql:123 -->.

A workspace `admin` can also SELECT the board row when `visibility = 'workspace'` OR when they have an explicit `board_members` row. For a `private` board with no explicit membership, the SELECT policy (`boards_select`) checks `is_board_member OR (visibility = 'workspace' AND is_workspace_member)` <!-- ref: supabase/migrations/0003_rls.sql:110-118 -->. A workspace admin without a `board_members` row on a private board cannot read its content rows (lists, cards, etc.) through the normal member-path policies; the structural write policies do not grant content visibility independently.

### Board membership implies workspace membership

When a user is added to a board via `board_members` INSERT, a trigger (`board_member_implies_ws_member_aiu`) inserts a `workspace_members` row at role `member` for the board's workspace, if none already exists <!-- ref: supabase/migrations/0063_board_member_implies_workspace_member.sql -->. This is a one-way, one-time bootstrap: the trigger does not elevate an existing workspace role and does not remove the workspace row if the board membership is later removed.

---

## How to change a role

**Workspace member role:** Navigate to `/w/<workspaceId>/settings`. The Members section lists every member. Use the role dropdown next to a member's name to switch between `member` and `admin`. The owner row's dropdown is disabled; the owner role cannot be changed via the UI <!-- ref: components/workspace/member-list.tsx:44 `disabled={m.role === "owner"}` -->. Workspace admin or owner role is required to submit the change (enforced by RLS `ws_members_admin_write` <!-- ref: supabase/migrations/0003_rls.sql:106 -->).

**Board member role:** Open the board, then open the Members panel (accessible from the board header). Select the role dropdown next to any member to switch between `admin`, `member`, and `observer`. Board admin or workspace admin/owner role is required <!-- ref: supabase/migrations/0003_rls.sql:143-158 `board_members_admin_write` -->.

**Dashboard member role:** Open the dashboard, then open the Share dialog. Each shared user has a role dropdown to switch between `viewer` and `editor`. Only the dashboard owner can open the share dialog and submit changes <!-- ref: supabase/migrations/0068_dashboard_share.sql `dashboard_members_owner_write` -->.

---

## Edge cases

**Sole owner:** There is no database-level constraint preventing the sole owner from being removed or having their role changed. The UI disables the owner row's dropdown and Remove button (role `=== "owner"` check) <!-- ref: components/workspace/member-list.tsx:44,71 -->, but the server action `changeMemberRoleImpl` and `removeMemberImpl` perform no sole-owner guard: they execute the UPDATE/DELETE and return "Forbidden" only if the RLS policy blocks the row, not if it would leave the workspace ownerless.

**Owner leaving workspace:** `removeMemberImpl` will execute if the caller is a workspace admin acting on themselves and the RLS row check passes. No ownership-transfer step is enforced. If the owner is removed, the workspace row persists (no `ON DELETE CASCADE` from `workspace_members` to `workspaces`) but no member will hold `role = 'owner'`.

**Role downgrade with in-flight operations:** Drizzle server actions are point-in-time; they re-check RLS on each call. Downgrading a board admin to `observer` while they have an open card editor in their browser does not cancel any in-progress mutation already sent to the server. Any subsequent write call (next save, comment post, etc.) will be rejected by the tightened RLS policy on the database side. There is no client-side session invalidation.

---

## Known gaps

- **`inviteMemberImpl` allows setting role `"owner"` at the type level but the UI omits it:** `changeMemberRoleImpl` in `actions/workspace-members.ts:43` accepts `"owner" | "admin" | "member"` and the RLS `ws_members_admin_write` policy does not block writing `role = 'owner'`. A workspace admin could call the action directly (bypassing the UI) and promote any member to owner. <!-- ref: actions/workspace-members.ts:44, supabase/migrations/0003_rls.sql:106 -->

- **`sla_policies_admin_write` USING clause allows board admin to modify SLAs, but the WITH CHECK clause restricts to workspace owner/admin only:** The `USING` side (for UPDATE/DELETE) checks `bm.role = 'admin'` (board admin), but the `WITH CHECK` side (for UPDATE verification after the fact) checks only workspace owner/admin <!-- ref: supabase/migrations/0029_sla.sql:51-62 -->. In practice Postgres applies WITH CHECK for INSERT/UPDATE row validation; a board admin who is not a workspace admin can DELETE an SLA row (USING passes) but cannot INSERT or UPDATE one (WITH CHECK fails). The asymmetry is likely unintentional.

- **`inviteBoardMemberImpl` does not restrict which roles the caller can assign:** The `board_members_admin_write` RLS policy gates write access to board admins and workspace admins, but it does not restrict which `role` value may be written. A board admin can promote another user to `admin` without restriction. No escalation guard exists. <!-- ref: supabase/migrations/0003_rls.sql:143-158, actions/board-members.ts:13 -->

- **No billing layer:** The workspace roles table references `owner` and the RLS grants owners exclusive delete rights, but no billing or subscription management surface exists anywhere in the codebase. The "manage billing" capability listed in typical owner-role documentation has no implementation here.
