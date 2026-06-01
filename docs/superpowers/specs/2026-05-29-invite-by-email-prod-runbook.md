# Invite-by-email — Production Deploy Runbook

Date: 2026-05-29. Companion to the design spec + plan in this folder.

The feature works end-to-end locally (integration + E2E green). Production needs
the steps below. The **domain gate is NOT enforced locally** (the auth hook is
unwired in local dev so the existing test suite can create `@x.io` users) — so
hook wiring is the one thing that can only be verified in the hosted project.

## Required hosted configuration

### 1. Apply migrations 0115–0120 to the prod DB — REQUIRED
```
supabase link --project-ref <prod-ref>
supabase migration up            # or: supabase db push
```
Brings: `workspace_invitations` table + RLS, the domain-gate carve-out function,
the accept trigger, admin-only + self read policies. Without these the actions
500 and the gate function doesn't exist.

### 2. Wire the *Before User Created* auth hook — REQUIRED (gate + carve-out)
Supabase Studio → **Authentication → Hooks → Before User Created** → point at
`public.auth_block_external_domains`.
- **Why:** the function only *enforces* the `innovina.it` gate (and the pending-
  invite carve-out) when wired as the hook. The migration defines the function;
  the hook runs it. Unwired → public `/signup` is NOT domain-gated.
- This is pre-existing infra for the gate (migration 0056); confirm it still
  points at the function after 0116/0119 `create or replace`d it.
- Verify (hosted SQL): `select has_function_privilege('supabase_auth_admin',
  'public.auth_block_external_domains(jsonb)','execute');` → must be `t`.

### 3. Set `NEXT_PUBLIC_APP_URL` (prod origin) — REQUIRED (or invite link breaks)
Vercel → Project → Settings → Environment Variables → `NEXT_PUBLIC_APP_URL =
https://<prod-host>` (Production + Preview).
- **Why:** the action builds `redirectTo = ${NEXT_PUBLIC_APP_URL}/accept-invite`.
  Unset → relative path → Supabase falls back to `site_url` root → the invite
  email link never lands on `/accept-invite`. (See [[project_invite_redirect_app_url]].)

### 4. Auth redirect allowlist — REQUIRED
Supabase Studio → Authentication → **URL Configuration**:
- `Site URL` = prod origin.
- `Redirect URLs` must include `https://<prod-host>/accept-invite` (and
  `/reset-password`). Locally `additional_redirect_urls` uses `/**` wildcards so
  this is already covered in dev; hosted needs the explicit prod URL.

### 5. SMTP for invite emails — REQUIRED
Supabase Studio → Authentication → SMTP. `inviteUserByEmail` sends through
Supabase SMTP. `forgot-password` already uses it, so confirm it's configured.
- The invite link uses the **implicit (hash) flow**; the `/accept-invite` page
  consumes the hash via `setSession` (fix `f43d796`), so no email-template change
  is needed.

### 6. `RESEND_API_KEY` + `RESEND_FROM` — OPTIONAL (Resend button only)
Only the **Resend** action delivers via Resend (`lib/invite-email.ts`). Unset →
it soft-fails (link still generated, delivery skipped). Set in Vercel env if
you want resend emails to actually send in prod.

## Post-deploy smoke test (canary)
1. As an owner, invite a real external address you control.
2. Confirm the invite email arrives (Supabase SMTP).
3. Click the link → lands on `/accept-invite` → set password → lands in the
   workspace as a member; the pending badge clears for the admin.
4. Negative: at public `/signup`, try a non-`innovina.it` address with NO pending
   invite → must be rejected (proves the hook is wired, step 2).

## Verified locally (2026-05-29)
| Item | Status |
|---|---|
| Migrations 0115–0120 effects (table, fn, 3 RLS policies, trigger) | ✓ present in local DB |
| Hook fn executable by `supabase_auth_admin`; revoked from `authenticated`/`anon` | ✓ (`t` / `f`,`f`) |
| Carve-out logic (block external / allow internal / allow pending / case-insensitive / revoked-no-bypass) | ✓ direct-function tests |
| `NEXT_PUBLIC_APP_URL` set; redirect allowlist `/**` | ✓ |
| Accept leg (hash → setSession → set password → land) | ✓ E2E |
| Domain-gate ENFORCEMENT (hook wired) | ⚠ not verifiable locally — verify in hosted (steps 2 + canary 4) |

## Known follow-ups (not blockers)
- `reset-password` shares the implicit-hash mechanism and likely needs the same
  `setSession`-from-hash handling its form currently lacks — verify in prod or
  port the `accept-invite-form` fix.
- Re-running the kill-survivor mutation pass (Stryker) after prod-only changes is
  unnecessary; the suite is local.
