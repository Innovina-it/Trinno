# Invite-by-email for new users (owner/admin) — Design

**Date:** 2026-05-29
**Status:** Approved design, pending implementation plan
**Author:** Ali + Claude

## Problem

Today a workspace owner/admin can only add someone who **already has an account**
(`inviteMember` → `find_user_id_by_email` → "No user with that email"). And the
`/signup` page is gated to the `innovina.it` domain by a Supabase
*Before User Created* hook, so an external person cannot self-register either.

We want owners/admins to invite a brand-new person **by email**, including
external domains, without weakening the public registration gate. The invitee
receives an email, clicks it, sets a password, and lands inside the inviting
workspace already as a member.

## Principle (the invariant we must not break)

- **Direct registration at `/signup` stays strictly domain-gated.** A stranger
  with a non-`innovina.it` email gets 403, unchanged.
- The domain gate is bypassed **only** for an email that currently has a
  **pending** invitation row. No pending invitation → normal domain rules.

## Decisions (resolved during brainstorming)

1. **Mechanism:** Supabase native invite (`admin.inviteUserByEmail`). Supabase
   creates the unconfirmed user and sends the secure invite-link email; the
   invitee lands on a set-password page that mirrors the existing
   `reset-password` page. We do **not** roll our own token crypto.
2. **Pending visibility:** the invitee appears in the workspace member roster
   **immediately** with a "Pending · invite sent" badge (membership row is
   created at invite time). Trello/Slack-style.
3. **Existing-vs-new:** one invite field. If the email already has an account,
   add them directly with no email (today's behavior). If not, run the invite +
   set-password flow. The action auto-detects which.
4. **Role of external invitees:** any non-owner role (admin/member/guest) at the
   inviter's discretion — no extra restriction on outside-domain people.

## Current-state references

- Domain gate: `supabase/migrations/0056_auth_domain_allowlist.sql:36`
  (`auth_block_external_domains`, allowlist `array['innovina.it']`).
- Current invite (existing users only): `actions/workspace-members.ts:42`
  (`inviteMemberImpl`) + `assertCanManageWorkspaceMembers` at `:19`.
- Membership model: `supabase/migrations/0001_init.sql:17-26`
  (`workspace_role` enum, `workspace_members` PK `(workspace_id, user_id)`).
- Role checks: `supabase/migrations/0003_rls.sql:9-50`
  (`is_workspace_member/admin/owner`), RLS for members at `:103-109`.
- Signup trigger: `supabase/migrations/0110_personal_workspace_auto_assign.sql:42`
  (`handle_new_user` — derives `display_name`/`handle` from the email local-part,
  needs no metadata, creates the personal workspace + owner membership).
- Set-password reference UI: `app/(auth)/reset-password/page.tsx` +
  `components/auth/reset-password-form.tsx:45` (`supa.auth.updateUser({ password })`).
- Service-role admin client: `lib/supabase/service-role.ts`
  (`getServiceSupabase()` → `sb.auth.admin.*`).

## Architecture

### Component 1 — `workspace_invitations` table (new)

```
workspace_invitations
  id           uuid primary key default gen_random_uuid()
  workspace_id uuid not null references public.workspaces(id) on delete cascade
  email        text not null            -- stored lowercased
  role         public.workspace_role not null   -- admin | member | guest (never owner)
  invited_by   uuid not null references public.profiles(id)
  user_id      uuid references public.profiles(id)   -- the auth user, set after creation
  status       text not null default 'pending'       -- 'pending' | 'accepted' | 'revoked'
  created_at   timestamptz not null default now()
  accepted_at  timestamptz

-- no duplicate LIVE invite per workspace+email:
create unique index workspace_invitations_pending_uq
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';
```

One row does triple duty: (a) authorizes the domain-gate carve-out,
(b) renders the "Pending" badge, (c) backs resend/revoke.

**What it does:** records an outstanding invitation and its lifecycle.
**Interface:** read by the domain hook (by email+status) and the roster query
(join on `workspace_members`); written by the invite/revoke server actions and
the acceptance trigger.
**Depends on:** `workspaces`, `profiles`, `workspace_role` enum.

### Component 2 — domain-gate carve-out (modify existing hook)

Prepend one check to `auth_block_external_domains`
(`0056_auth_domain_allowlist.sql`) in a **new migration** (don't edit the old one
in place — additive migration that `create or replace`s the function):

```sql
-- inside auth_block_external_domains, after computing email/email_domain,
-- BEFORE the allowlist test:
if exists (
  select 1 from public.workspace_invitations
   where email = lower(coalesce(event->'user'->>'email',''))
     and status = 'pending'
) then
  return '{}'::jsonb;            -- invited → allow any domain
end if;
-- ...existing innovina.it allowlist test unchanged below...
```

`security definer` + fully-qualified table name → reads regardless of RLS.
**Correctness depends on ordering:** the invitation row must be committed before
`inviteUserByEmail` triggers the hook (guaranteed by Component 3's sequence).

### Component 3 — `inviteMember` rewrite (`actions/workspace-members.ts`)

```
inviteMemberImpl(token, { workspaceId, email, role }):
  parsed = InviteMemberInput.parse(input)      -- email lowercased here
  actorId = decodeSub(token)
  assertCanManageWorkspaceMembers(tx, workspaceId, actorId)   -- owner/admin only

  existingId = find_user_id_by_email(email)

  IF existingId is not null:            # AUTO-DETECT: existing user
     insert workspace_members(workspaceId, existingId, role) onConflictDoNothing
     return { kind: 'added', userId: existingId }

  ELSE:                                 # NEW INVITE (service-role client)
     sb = getServiceSupabase()
     insert workspace_invitations(workspaceId, email, role, invited_by=actorId,
                                  status='pending')           # COMMIT before next step
     try:
        { data, error } = sb.auth.admin.inviteUserByEmail(email, {
            redirectTo: `${NEXT_PUBLIC_APP_URL}/accept-invite`
        })
        # before-user-created hook sees the pending invite → allows any domain
        # handle_new_user fires → invitee personal workspace + profile
        if error: throw
        newUserId = data.user.id
        update workspace_invitations set user_id = newUserId where ...
        insert workspace_members(workspaceId, newUserId, role)   # membership exists now
        return { kind: 'invited', userId: newUserId }
     catch e:
        delete workspace_invitations where (workspaceId, email, status='pending')  # no lingering bypass
        # if Supabase says "user already registered" (TOCTOU race): re-run the
        # existing-user branch (lookup again + direct add) instead of surfacing an error
        rethrow or fall back
```

Public `inviteMember` wrapper keeps `requireUser()` + `revalidateWorkspace()` as
today. Return shape gains a `kind` discriminator so the UI can toast
"Added" vs "Invite sent".

### Component 4 — acceptance page `/accept-invite` (new)

- Route under `app/(auth)/accept-invite/page.tsx` + a client form component,
  near-clone of `reset-password`:
  - Supabase invite link lands here with a session attached (same as recovery).
  - Copy: "Welcome to <workspace> — set your password to finish."
  - Submit → `supa.auth.updateUser({ password })`.
  - On success the user is authenticated → a small server action returns the
    workspace id from `workspace_invitations` for the current user (most recent
    row) → redirect to `/w/<id>`. If none resolves, redirect to `/` (they are
    already a member; normal landing picks a workspace).
- No-session guard mirrors `reset-password-form.tsx:31-38` ("invite link expired
  or invalid — ask for a new one").

### Component 5 — acceptance trigger (mark accepted)

`AFTER UPDATE ON auth.users` trigger: when `email_confirmed_at` transitions
`null → not null`, set matching `workspace_invitations.status='accepted',
accepted_at=now()` for that user's email. Robust regardless of which page the
user lands on; consistent with the existing `handle_new_user` `auth.users`
trigger. (Alternative considered: a `markInviteAccepted` server action called
from the accept page — rejected as less reliable since it depends on that one
call firing.)

### Component 6 — roster UI (pending badge + controls)

- Member roster query left-joins `workspace_invitations` (status='pending') to
  flag pending rows → render **"Pending · invite sent"** badge.
- Owner/admin row actions on a pending member:
  - **Resend** → the auth user already exists, so `inviteUserByEmail` would error
    ("already registered"). Resend uses `admin.generateLink({ type: 'invite',
    email, options: { redirectTo: '/accept-invite' } })` to mint a fresh link,
    then emails it via the existing Resend channel (`lib/notify-email.ts`).
    Surface "invite re-sent". (Acceptable: initial invite uses Supabase's email
    template, resend uses Resend's — both deliver the same `/accept-invite` link.)
  - **Revoke** → delete the `workspace_members` row + set invitation
    `status='revoked'`. The auth user is left intact (may belong to other
    workspaces); the bypass evaporates because status ≠ pending.

## Data flow (new-invite happy path)

```
owner/admin types bob@acme.com in workspace members UI
  → inviteMember server action (owner/admin asserted)
  → find_user_id_by_email → null
  → INSERT workspace_invitations(pending)            [committed]
  → admin.inviteUserByEmail(bob@acme.com, redirectTo=/accept-invite)
       → before-user-created hook: pending invite found → ALLOW (domain ignored)
       → auth.users insert → handle_new_user → bob's personal ws + profile
  → UPDATE invitation.user_id ; INSERT workspace_members(ws, bob, role)
  → roster shows bob as "Pending"
... bob receives email, clicks link ...
  → /accept-invite (session attached) → set password → updateUser
       → email_confirmed_at set → AFTER UPDATE trigger → invitation.accepted
  → bob redirected into the workspace; badge cleared; full member
```

## Error handling

- Invite send fails after invitation insert → delete the pending invitation row
  (prevents a lingering domain bypass), surface a retryable error.
- `inviteUserByEmail` "user already registered" (race / prior unaccepted invite)
  → fall back to the existing-user direct-add branch.
- Expired/invalid invite link at `/accept-invite` → friendly message + path to
  request a fresh invite (owner/admin uses Resend).
- Revoke after acceptance → no-op on bypass (already accepted); still removes the
  membership row.

## Security

- Invitations are created only by workspace owners/admins
  (`assertCanManageWorkspaceMembers`, unchanged).
- RLS on `workspace_invitations`: SELECT for workspace members,
  INSERT/UPDATE/DELETE for workspace admins — mirrors `workspace_members`
  policies (`0003_rls.sql:103-109`). The domain hook reads via `security definer`,
  not via the requester's RLS context.
- Domain bypass is scoped to `status='pending'` **only**. Accepted/revoked rows
  grant nothing, so a stale row cannot be used to pre-authorize a signup.
- Email lowercased + partial-unique index → no duplicate live invites.
- Role capped at admin/member/guest at the validation layer (never owner);
  enforce in `InviteMemberInput` (`lib/validation`).
- Token issuance/expiry is delegated to Supabase (no custom crypto).

## Testing

Integration (Vitest, `tests/integration/`):
- **New email** → invitation(pending) + member(pending) + auth user + personal ws
  created; simulate confirm → status flips to accepted, badge clears.
- **Existing email** → direct add, **no** email, **no** invitation row.
- **Domain gate intact (regression on the core invariant)** → external email with
  **no** pending invitation is still rejected by `auth_block_external_domains`.
- **Revoke** → membership row gone + invitation `status='revoked'` + bypass gone.
- **RLS** → a plain `member` (non-admin) cannot create or manage invitations.
- **Race** → "user already registered" path falls back to direct add.

## Config to verify during planning (not code)

- Supabase Auth redirect-URL allowlist must include `/accept-invite`.
- Invite emails need working SMTP — `forgot-password` already uses Supabase email,
  so this is likely configured; verify.
- Supabase invite-link expiry default (~24h) is acceptable; expiry → Resend.

## Out of scope

- Board-level invitations for new users (this is workspace-level; board invites of
  existing users are unchanged).
- Bulk/CSV invites.
- Changing the `/signup` domain policy itself.

## Open questions

None outstanding. (Default accepted: external invitees may receive any non-owner
role.)
