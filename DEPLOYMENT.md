# Deployment

End-to-end checklist for taking this app online with Supabase Cloud + Vercel.

## 0. Prereqs

- [ ] GitHub repo pushed (already done)
- [ ] Supabase Cloud account (already done)
- [ ] Vercel account (already done)
- [ ] `supabase` CLI installed locally (`brew install supabase/tap/supabase`)

## 1. Provision Supabase Cloud

1. New project in dashboard. Pick region near your team. Save the database password.
2. From **Settings -> API**, copy:
   - `Project URL`
   - `anon public` key
   - `service_role secret` key
3. From **Settings -> Database -> Connection pooling** (transaction mode), copy the pooled connection string (`*.pooler.supabase.com:6543`).

## 2. Push schema

```bash
supabase login                     # opens browser
supabase link --project-ref <REF>  # ref is in dashboard URL
supabase db push                   # applies all 50+ migrations
```

Verify in Supabase Studio:
- [ ] Tables present: `boards`, `lists`, `cards`, `notifications`, `attachments`, `dashboards`, `gadgets`, `sprints`, etc.
- [ ] **Database -> Publications -> `supabase_realtime`** includes the live tables (`cards`, `lists`, `boards`, `notifications`, `attachments`).
- [ ] **Database -> Roles** the `postgres` role exists (used by Drizzle `dbAsUser`).
- [ ] **Authentication -> Policies** shows RLS rules per table.
- [ ] **Storage -> Buckets** `card-attachments` exists, `public = false`.

## 3. Vercel project

1. Vercel dashboard -> **Add New -> Project -> Import Git Repository** -> pick repo.
2. Framework: **Next.js** (auto).
3. Build command: `npm run build` (default).
4. Environment variables (Production + Preview):

   ```
   NEXT_PUBLIC_SUPABASE_URL        = <Project URL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY   = <anon key>
   SUPABASE_SERVICE_ROLE_KEY       = <service role key>
   DATABASE_URL                    = <pooled connection string>
   ```

5. Click **Deploy**. ~2 min.

## 4. Configure Supabase Auth URLs

Supabase Studio -> **Authentication -> URL Configuration**:

```
Site URL:      https://<your-vercel-app>.vercel.app
Redirect URLs: https://<your-vercel-app>.vercel.app/auth/callback
               https://*.vercel.app/auth/callback
```

When you add a custom domain (step 9), update Site URL.

## 5. Email provider

Quickest path: keep Supabase built-in SMTP (rate-limited 3/hr per email, fine for internal demo).

For real use, plug in:

- **Resend** (recommended, free tier 3k/mo): sign up, verify domain, copy SMTP creds into Supabase **Authentication -> Email Templates -> SMTP**.
- **Postmark / SES** also work.

## 6. Restrict signup (internal-team)

Default: any email can sign up. Pick one path before launch.

### Option A. Disable signup outright (admin-only invite)

Supabase Studio -> **Authentication -> Providers -> Email** -> toggle off `Enable signups`. New members must be invited via Supabase Studio -> Authentication -> Users.

### Option B. Domain allowlist (recommended for internal team)

Template SQL is at `supabase/migrations/0056_auth_domain_allowlist.sql.disabled`.

1. Edit the file: set `allowed_domains` to your real domain(s) (e.g. `array['innovina.it']`).
2. Rename to drop the `.disabled` suffix.
3. Either:
   - Self-hosted Supabase: re-run `supabase db push` to install the trigger.
   - Supabase Cloud: open **Authentication -> Hooks -> Send-Email / Before-User-Created**, point at the function. (Cloud restricts direct triggers on `auth.users`.)

### Option C. Vercel deployment protection

Vercel Pro plan -> Project -> **Settings -> Deployment Protection -> Standard Protection** with shared password. Cheapest gate against the open internet, layered on top of A or B.

## 7. Storage policies

The `card-attachments` bucket is private (`public = false`) and access happens server-side through signed URLs from `app/api/upload/route.ts`. RLS on `storage.objects` is owned by `supabase_storage_admin`, so the migration runner cannot apply the policy via `supabase db push` (`must be owner of table objects (SQLSTATE 42501)`).

The template lives at `supabase/migrations/0057_storage_rls.sql.disabled`. Apply it manually after first deploy:

1. Open Supabase Studio -> **SQL Editor**.
2. Paste the policy block from the file (the `do $$ ... drop policy ...` cleanup + `create policy card_attachments_member_read ...`).
3. Run.
4. Verify in Supabase Studio -> **Storage -> Policies** that `card_attachments_member_read` exists on `storage.objects`.

This is defense-in-depth: the bucket is already private and access is signed-URL-mediated.

## 8. Error monitoring (recommended)

Sign up at https://sentry.io, create a Next.js project, then locally:

```bash
npx @sentry/wizard@latest -i nextjs --saas --org <ORG> --project <PROJ>
```

The wizard:
- installs `@sentry/nextjs`
- writes `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- updates `next.config.ts` with the Sentry plugin
- adds the `instrumentation.ts` hook

After running, set the Sentry env vars in Vercel:

```
SENTRY_DSN                        = <DSN from Sentry>
NEXT_PUBLIC_SENTRY_DSN            = <same DSN>
SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN  (build-time, optional)
```

## 9. Custom domain

Vercel -> Project -> **Domains -> Add** -> follow DNS instructions. Vercel issues TLS automatically. Then update the Supabase Site URL (step 4).

## 10. Smoke test

Open the deployed URL:

- [ ] `/signup` with a real email (ignore option B/C while testing).
- [ ] Confirmation email arrives.
- [ ] Click link -> lands on `/`.
- [ ] Create workspace -> create board -> drag a card.
- [ ] Open `/inbox`, `/dashboards`, `/w/<id>/roadmap`, `/settings`.
- [ ] Open card modal, leave a comment, hit Cmd/Ctrl+Enter.
- [ ] Open in another browser tab -> realtime updates propagate.

## 11. Day-1 ops checklist

- [ ] Migrations applied to prod DB.
- [ ] RLS policies present on every table (`select * from pg_policies`).
- [ ] Realtime publication includes the right tables.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` only in server env (never `NEXT_PUBLIC_`).
- [ ] `card-attachments` bucket exists, public=false, storage RLS migration `0057` applied.
- [ ] Auth Site URL + redirect URLs match prod origin.
- [ ] Email provider configured (Supabase default or external SMTP).
- [ ] Signup gate enabled (option A / B / C).
- [ ] Sentry DSN wired (or accepted skip).
- [ ] CI running on `main` (lint + tests).

## 12. Cost estimate (MVP)

| Item                       | Cost            |
|----------------------------|-----------------|
| Vercel Hobby               | $0 (non-commercial) |
| Vercel Pro (if commercial) | $20 / mo        |
| Supabase Free              | $0 (pauses after 1 wk inactivity) |
| Supabase Pro (recommended) | $25 / mo        |
| Domain                     | ~$1 / mo        |
| Resend free tier           | $0 (3 k emails / mo) |
| Sentry free tier           | $0 (5 k events / mo) |
| **Total realistic**        | **$25 - $55 / mo** |

## 13. Common gotchas

- **`db push` errors** on a migration: usually order-of-operations or RLS bootstrap. Read the exact line; many migrations expect prior tables.
- **Vercel build fails**: check the build log. Common cause is a missing env var; the `useSearchParams` Suspense boundary case is already handled in this repo.
- **"Invalid login URL" after deploy**: step 4 not done correctly.
- **Storage upload 403**: bucket policy missing or service role key wrong env var name.
- **Realtime not echoing**: check `supabase_realtime` publication includes the table; check the channel filter matches `recipient_user_id=eq.<uid>`.
- **Auth callback hangs**: if `tr_seed_demo` cookie is set, the callback runs the demo seeder which can take a few seconds. The `loading.tsx` you may want to add lives at `app/(auth)/auth/callback/loading.tsx`.

## 14. Maintenance

- Upgrade `next` and `supabase-js` quarterly.
- Re-run `supabase db diff` after schema edits and commit the generated migration.
- Backups: Supabase Pro auto-backups daily. Free tier has none -> trigger manual `pg_dump` once a week if on Free.
- Rotate `service_role` key once / year (Supabase dashboard -> regenerate, then update Vercel env).
