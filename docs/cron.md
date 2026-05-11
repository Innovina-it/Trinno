# Cron Wiring Guide

> Last updated: 2026-05-11

---

## Security Notes

| Route | Finding |
|---|---|
| `POST /api/notifications/digest` | Auth is **skipped when `CRON_KEY` is unset**. Fine for local dev; ensure `CRON_KEY` is set in every non-dev environment. |

---

## Overview

| Route | Method | Suggested Cadence | What It Does |
|---|---|---|---|
| `/api/cron/send-emails` | GET | Every 5 min | Drains `notifications` rows where `email_sent_at IS NULL` and the recipient opted in to per-event email; sends via Resend and stamps `email_sent_at`. |
| `/api/notifications/digest` | POST | Daily 09:00 UTC | Builds a 24-hour grouped summary for every user with `email_digest_optin = true`, sends via Resend, then marks included rows as sent so the per-event sender skips them. |
| `/api/sla/scan` | POST | Every 15 min (recommended) | Runs SLA violation scan for a given `boardId`; marks overdue cards. Requires a `boardId` UUID in the JSON body. |

> `/api/watchers/check` is **not** a cron target — it is a client-side query endpoint that requires an active user session.

---

## Auth Contract

### `/api/cron/send-emails`

```
Authorization: Bearer <CRON_SECRET>
```

- Checked on every request; returns `401` if wrong or missing, `500` if `CRON_SECRET` env var is unset.
- Required env var: **`CRON_SECRET`**

### `/api/notifications/digest`

```
x-cron-key: <CRON_KEY>
```

- If `CRON_KEY` is set, the header must match exactly; otherwise `401`.
- If `CRON_KEY` is **not set**, auth is skipped (dev convenience — do not ship to production without this var).
- Required env var: **`CRON_KEY`**

### `/api/sla/scan`

```
Authorization: Bearer <CRON_SECRET>
```

- Checked on every request; returns `401` if wrong or missing, `500` if `CRON_SECRET` env var is unset.
- Required env var: **`CRON_SECRET`**

### Generating a secret

```bash
openssl rand -hex 32
```

Use separate values for `CRON_SECRET` and `CRON_KEY`.

---

## Vercel Deployment

### `vercel.json`

Vercel cron always issues a **GET** request. `/api/cron/send-emails` is GET — fine. `/api/notifications/digest` and `/api/sla/scan` are POST-only, so they **cannot be driven directly by `vercel.json` crons**. Use GitHub Actions (see below) or an external scheduler for those two.

For the one GET-compatible route:

```json
{
  "crons": [
    { "path": "/api/cron/send-emails", "schedule": "*/5 * * * *" }
  ]
}
```

Vercel injects an `x-vercel-cron: 1` header on scheduled invocations. The current handler does **not** check this header — it relies solely on `Authorization: Bearer`. Both headers are present when Vercel fires the cron, so behavior is correct.

### Setting secrets

```bash
# Add once per Vercel project
vercel env add CRON_SECRET production
vercel env add CRON_KEY production
vercel env add RESEND_API_KEY production
vercel env add RESEND_FROM production        # e.g. "Acme <noreply@acme.com>"
vercel env add NEXT_PUBLIC_APP_URL production
```

To rotate: `vercel env rm CRON_SECRET production` then `vercel env add CRON_SECRET production`.

---

## Docker / Self-Hosted

Set `TZ=UTC` at the container or system level so schedules are predictable.

### `/etc/cron.d/trello-foundation`

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
TZ=UTC
CRON_SECRET=<your-secret>
CRON_KEY=<your-cron-key>
APP_URL=https://app.example.com

# Send pending per-event emails — every 5 minutes
*/5 * * * * root curl -fsS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${APP_URL}/api/cron/send-emails" \
  >> /var/log/cron-send-emails.log 2>&1

# Daily digest — 09:00 UTC
0 9 * * * root curl -fsS -X POST \
  -H "x-cron-key: ${CRON_KEY}" \
  -H "Content-Type: application/json" \
  "${APP_URL}/api/notifications/digest" \
  >> /var/log/cron-digest.log 2>&1

# SLA scan — every 15 minutes (replace BOARD_ID with each board's UUID,
# or wrap in a script that iterates boards from the DB)
*/15 * * * * root curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"boardId":"<board-uuid>"}' \
  "${APP_URL}/api/sla/scan" \
  >> /var/log/cron-sla-scan.log 2>&1
```

Reload cron after editing:
```bash
systemctl reload cron   # Debian/Ubuntu
# or
service crond reload    # RHEL/CentOS
```

---

## GitHub Actions Fallback

Use this when running on a host without system crond or when you need audit trails in GitHub.

### `.github/workflows/cron.yml`

```yaml
name: Scheduled Cron Jobs

on:
  schedule:
    - cron: "*/5 * * * *"   # send-emails: every 5 min
    - cron: "0 9 * * *"     # digest: daily 09:00 UTC
    - cron: "*/15 * * * *"  # sla-scan: every 15 min
  workflow_dispatch:          # allow manual trigger from Actions UI

env:
  APP_URL: ${{ vars.APP_URL }}   # set as a repo variable

jobs:
  send-emails:
    if: github.event.schedule == '*/5 * * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger send-emails
        run: |
          curl -fsS \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "$APP_URL/api/cron/send-emails"

  daily-digest:
    if: github.event.schedule == '0 9 * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger daily digest
        run: |
          curl -fsS -X POST \
            -H "x-cron-key: ${{ secrets.CRON_KEY }}" \
            -H "Content-Type: application/json" \
            "$APP_URL/api/notifications/digest"

  sla-scan:
    if: github.event.schedule == '*/15 * * * *' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - name: Trigger SLA scan
        # Replace <board-uuid> or use a matrix strategy for multiple boards
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{"boardId":"<board-uuid>"}' \
            "$APP_URL/api/sla/scan"
```

**Required secrets/vars** (set under repo Settings → Secrets and variables):

| Name | Kind | Value |
|---|---|---|
| `CRON_SECRET` | Secret | Value of your `CRON_SECRET` env var |
| `CRON_KEY` | Secret | Value of your `CRON_KEY` env var |
| `APP_URL` | Variable | e.g. `https://app.example.com` |

---

## Local Development

Run the dev server first: `npm run dev` (starts on `http://localhost:3000`).

```bash
# Trigger send-emails
curl -fsS \
  -H "Authorization: Bearer <your-secret>" \
  http://localhost:3000/api/cron/send-emails | jq

# Trigger daily digest
# (CRON_KEY auth is skipped when the env var is not set in .env.local)
curl -fsS -X POST \
  -H "x-cron-key: <your-cron-key>" \
  -H "Content-Type: application/json" \
  http://localhost:3000/api/notifications/digest | jq

# Trigger SLA scan for a specific board
curl -fsS -X POST \
  -H "Authorization: Bearer <your-cron-secret>" \
  -H "Content-Type: application/json" \
  -d '{"boardId":"<board-uuid>"}' \
  http://localhost:3000/api/sla/scan | jq
```

To simulate Vercel's automatic bearer injection locally, add `CRON_SECRET` to `.env.local`.

---

## Observability

### What to watch

| Route | Success signal | Key log prefix |
|---|---|---|
| `/api/cron/send-emails` | JSON with `{ sent, failed, skipped }` counts | `[notify-email]` |
| `/api/notifications/digest` | JSON `{ sent, skipped, errors }` | `[digest]` |
| `/api/sla/scan` | JSON `{ breachedActive }` | (no prefix currently) |

### Common failure modes

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` on `/api/cron/send-emails` | `CRON_SECRET` mismatch between caller and env var; check for trailing whitespace |
| `500 CRON_SECRET not configured` | Env var not set on the deployment; run `vercel env add CRON_SECRET production` |
| `401 Unauthorized` on `/api/sla/scan` | `CRON_SECRET` mismatch between caller and env var; check for trailing whitespace |
| Digest runs but `sent=0, skipped=N` | `RESEND_API_KEY` is unset; emails are silently skipped |
| Digest `errors > 0` | Resend API rejection — check `[digest] resend error` log lines for HTTP status and body |
| `/api/notifications/digest` returns `401` in production | `CRON_KEY` env var is set but caller sent wrong or missing header |
| SLA scan `400` / Zod parse error | Missing or non-UUID `boardId` in POST body |
| RLS rejection (Supabase `42501`) | Service-role key not configured; the digest and SLA routes require a service-role Supabase client |
| GitHub Actions trigger does not fire | GH disables scheduled workflows on inactive repos after 60 days; re-enable from Actions UI |

### Log redirection (self-hosted)

```bash
# Rotate logs weekly (logrotate config)
# /etc/logrotate.d/trello-cron
/var/log/cron-*.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
}
```
