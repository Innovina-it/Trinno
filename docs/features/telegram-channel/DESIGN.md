# Telegram Notification Channel — Detailed Design

Status: **DESIGN / Gate 1** (no code yet)
Author: AI-assisted (ai-dev-control workflow)
Date: 2026-06-05
Decisions locked at Gate 0: deep-link linking · thin channel interface (migrate email in) · per-kind toggles.

---

## 1. Spec core

| | |
|---|---|
| **Goal** | Deliver per-event **activities** and the **daily digest** to users over Telegram, in addition to email/in-app. Users self-link their own Telegram account. |
| **Done looks like** | A user clicks "Connect Telegram" in Settings, taps Start in Telegram, and thereafter receives (a) per-event notifications they've enabled and (b) the daily digest as Telegram messages, gated by their per-kind toggles. Disconnect works. |
| **Must not change** | Existing email + in-app delivery must keep working (invite emails, digest assembly, in-app bell). Notification DB triggers unchanged. No regression to `user_notification_prefs` semantics for existing channels. Bot token never reaches the client. |

**Build tier when implemented: 2 → 3.** Shared notification delivery (Tier 2) **plus** Tier-3 elements: a new prod secret (bot token), a public inbound webhook, RLS-bypassing writes from the webhook, and external-account linking. Full gates apply; extra approval before touching email send paths and before exposing the webhook in prod.

---

## 2. Why an abstraction (recon finding)

There is **no channel transport layer today**. Delivery is hardcoded to email, with the Resend HTTP call duplicated in three places:

- `lib/notify-email.ts` (per-event)
- `app/api/notifications/digest/route.ts` (digest)
- `lib/invite-email.ts` (invites)

The `user_notification_prefs(user_id, kind, channel, enabled)` table (`lib/db/schema.ts:455`) was already built channel-generic — but `channel` is gated to `in_app|email|push` by the Zod enum at `actions/user-notification-prefs.ts:11`. Email is itself only **half-wired**: the settings page says "Email delivery is not wired yet" (`app/(app)/settings/notifications/page.tsx:67`) and `vercel.json` registers a single cron (`send-emails`, daily 08:00) — the digest route is not scheduled at all.

**Implication:** Telegram cannot "plug into" a mature multi-channel core because none exists. We *create* the abstraction — which is exactly what the "future chat apps" requirement needs. This converts the existing email triplication into a single `EmailChannel` and makes a future Slack/Discord channel ≈ one new file.

---

## 3. Architecture

Two small interfaces + a registry + two generic tables.

```ts
// lib/notifications/channels/types.ts
export type ChannelId = "email" | "telegram"; // future: "slack" | "discord"

// Channel-neutral content; each channel renders to its own native format.
export interface RenderableEvent  { notification: NotificationRow; }
export interface DigestModel      { groups: DigestGroup[]; date: string; total: number; }

export interface DeliveryResult { status: "sent" | "skipped" | "failed"; error?: string; }

// HOW we deliver on a channel.
export interface NotificationChannel {
  id: ChannelId;
  isLinked(userId: string): Promise<boolean>;          // reachable right now?
  sendEvent(userId: string, e: RenderableEvent): Promise<DeliveryResult>;
  sendDigest(userId: string, d: DigestModel): Promise<DeliveryResult>;
}

// HOW a user connects an account (deep-link for TG, OAuth for Slack, …).
export interface ChannelLinker {
  id: ChannelId;
  startLink(userId: string): Promise<{ url: string; expiresAt: string }>;
  // completion is channel-specific (webhook / OAuth callback)
  unlink(userId: string): Promise<void>;
}
```

```ts
// lib/notifications/channels/registry.ts
export const channels: NotificationChannel[] = [emailChannel, telegramChannel];
export const linkers:  Record<ChannelId, ChannelLinker> = { telegram: telegramLinker /* email: n/a */ };
```

**The cron dispatcher loops the registry instead of hardcoding email.** Adding a channel never touches the dispatcher.

### Digest refactor (the only change to existing email logic)
Split `lib/notifications/email-digest.ts` into:
- `buildDigestModel(userId) → DigestModel` — channel-neutral data assembly (reused as-is).
- `EmailChannel.sendDigest` — the existing HTML rendering (moved, behavior unchanged).
- `TelegramChannel.sendDigest` — new HTML/Markdown renderer.

This is the "migrate email into the interface" work. Email behavior is preserved; only its call site moves behind `EmailChannel`.

---

## 4. Data model

### 4.1 `user_channel_links` — per-user external identity (channel-generic)
```
user_channel_links
  user_id        uuid        not null            -- auth.users
  channel        text        not null            -- 'telegram' (reused by slack/discord later)
  external_id    text                            -- telegram chat_id; null until linked
  link_token_hash text                           -- SHA-256 of one-time token; null after link
  link_token_exp timestamptz                     -- TTL, e.g. now()+15min
  status         text        not null default 'pending'  -- pending | linked | revoked
  linked_at      timestamptz
  PRIMARY KEY (user_id, channel)
  UNIQUE (channel, external_id)                   -- one TG account ↔ one app user
```
Closest existing analog: `user_notification_prefs` (composite PK, per-user). New table because it stores identity/secrets, not preferences.

### 4.2 `notification_deliveries` — channel-neutral send ledger
Replaces the per-channel `email_sent_at` column pattern (which would force `telegram_sent_at`, `slack_sent_at`, … — the exact duplication the abstraction kills).
```
notification_deliveries
  notification_id uuid not null references notifications(id) on delete cascade
  channel         text not null
  status          text not null default 'pending'  -- pending|sent|skipped|failed
  attempts        int  not null default 0
  sent_at         timestamptz
  error           text
  PRIMARY KEY (notification_id, channel)
```
**Bridge for email:** keep `notifications.email_sent_at` readable during transition; write new email deliveries into the ledger going forward. (Alternative low-blast option: keep `*_sent_at` columns and add `telegram_sent_at`. Rejected — does not scale to "future chat apps".)

### 4.3 Digest opt-in (per channel)
Reuse `user_notification_prefs` with a reserved kind `digest.daily`:
`(user_id, kind='digest.daily', channel='telegram', enabled=true)`. No new schema, fully channel-generic. `profiles.email_digest_optin` is bridged for email (left as-is to avoid disrupting the live email path).

### 4.4 Channel allow-list
Add `"telegram"` (and `"digest.daily"` reserved kind) to the Zod enum at `actions/user-notification-prefs.ts:11`.

Migration: `0124_telegram_channel.sql` (latest is `0123`). Includes both tables, indexes (`user_channel_links(channel, external_id)`, `notification_deliveries(channel, status)`), RLS (user reads/writes only their own link rows; deliveries are service-role only), and `on delete cascade` for GDPR.

---

## 5. Account linking — bot deep-link flow

```
User                    App (Next.js)                 Telegram               Bot Webhook
 |  Connect Telegram ----> startTelegramLink()           |                      |
 |                         mint token, store hash+TTL     |                      |
 |  <--- t.me/Bot?start=TOKEN                             |                      |
 |  open link --------------------------------------> shows Start               |
 |  tap Start --------------------------------------> /start TOKEN ----> POST /api/telegram/webhook
 |                                                       |             verify secret header
 |                                                       |             match token hash (unexpired, pending)
 |                                                       |             set external_id=chat.id, status=linked
 |                                                       | <---------- sendMessage "✅ Connected"
 |  <--- settings flips to "Connected" (realtime/poll)   |                      |
```

- **Token:** 32-byte random, **hashed at rest** (`link_token_hash`), single-use, 15-min TTL. Compared on webhook.
- **Server action `startTelegramLink()`** follows house style (`requireUser` → `decodeSub(jwt)` → `dbAsUser`), rate-limited to prevent token spam. Returns `https://t.me/<BOT_USERNAME>?start=<token>`.
- **Webhook auth:** register with `setWebhook(url, secret_token)`; Telegram sends `X-Telegram-Bot-Api-Secret-Token` on every call — verify it equals `TELEGRAM_WEBHOOK_SECRET`. Do **not** put the bot token in the URL.
- **Webhook** uses `getServiceSupabase()` (no user session) and may only mutate the single matching `pending` row. Idempotent by Telegram `update_id`.
- **Unlink:** `unlinkTelegram()` sets `status='revoked'`, clears `external_id`.

---

## 6. Delivery flows

### 6.1 Per-event "activities"
DB triggers insert `notifications` rows (unchanged). A dispatcher cron processes them:

```
/api/cron/send-notifications   (auth: Bearer CRON_SECRET)
  for channel in channels:
    rows = notifications without a 'sent' delivery for {channel}, recent window
    for row in rows:
      if not channel.isLinked(user) or not pref(kind,channel).enabled: ledger.skip; continue
      result = channel.sendEvent(user, row); ledger.write(result, attempts++)
```
Telegram send → `POST https://api.telegram.org/bot<token>/sendMessage` with `chat_id`, HTML text, and an inline button deep-linking to the card.

**Latency callout:** per-event email runs on a **daily** cron today, i.e. email "activities" are not actually near-real-time. Telegram activities should feel prompt → needs a **frequent dispatcher cron** (every 1–5 min). Trade-off: cron frequency vs. invocation cost. (Alternative: send at emit-time — rejected; DB triggers can't cleanly call external HTTP, and it couples sending into the request path.)

### 6.2 Daily digest
`buildDigestModel(userId)` → each opted-in, linked user gets one rendered message. Register a digest cron in `vercel.json` (currently absent — note this also means email digest may not run today). Throttle to respect Telegram limits.

---

## 7. Rendering Telegram messages

- `parse_mode: "HTML"` (safer escaping than MarkdownV2).
- **Per-event:** `🔔 <b>{actor}</b> {verb} <b>{card}</b>` + board/list context + excerpt + inline "Open card" button.
- **Digest:** grouped by kind; **4096-char cap** → truncate with "+N more in app".
- **Telegram limits:** ~30 msg/s global, **1 msg/s per chat** → digest fan-out must throttle/queue.

---

## 8. API surface

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/telegram/webhook` | `X-Telegram-Bot-Api-Secret-Token` == `TELEGRAM_WEBHOOK_SECRET` | Receive `/start`, blocked-bot, etc. |
| `POST /api/cron/send-notifications` | `Bearer CRON_SECRET` | Dispatcher (all channels, per-event) |
| `POST /api/notifications/digest` (exists) | `x-cron-key` | Extend to loop channels; register in vercel.json |
| `startTelegramLink()` / `unlinkTelegram()` (server actions) | `requireUser` | Link lifecycle |
| `scripts/telegram-set-webhook.mjs` (one-off) | — | `setWebhook` bootstrap |

New env vars (convention `SERVICE_*`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.

---

## 9. Security & privacy

- Bot token + webhook secret are **server-only**; never bundled to client.
- Link token **hashed at rest**, single-use, 15-min TTL; `startLink` rate-limited.
- Webhook verifies secret header, is **idempotent** (dedupe by `update_id`), and only touches the matching pending row via service-role.
- `UNIQUE(channel, external_id)` prevents one Telegram account linking to two users.
- **GDPR:** `chat_id` is personal data → `on delete cascade` from auth.users, explicit unlink, and deletion on account close.
- RLS: users read/write only their own `user_channel_links`; `notification_deliveries` is service-role only.

---

## 10. Extensibility — adding Slack/Discord later

Adding a channel touches **only**:
1. New `SlackChannel implements NotificationChannel` (+ `SlackLinker implements ChannelLinker`) — one/two files.
2. Add `"slack"` to `ChannelId` + the Zod enum.
3. Reuse `user_channel_links` (channel='slack') + `notification_deliveries` (channel='slack').
4. Add a settings column.

**Untouched:** notifications table, DB triggers, digest assembly, dispatcher cron, prefs schema. The linking *method* varies per channel (deep-link vs OAuth) but is isolated behind `ChannelLinker`. This is the future-proof core the requirement asked for.

---

## 11. Failure modes

| Failure | Handling |
|---|---|
| User blocks/deletes bot | `sendMessage` 403 → mark link `revoked`, surface "Reconnect" in settings |
| Token expired before tap | Webhook finds no valid pending row → reply "link expired, generate a new one" |
| Webhook downtime | Telegram retries; idempotency dedupes; one success suffices to link |
| Telegram API outage | Deliveries `failed`; retried next cron with `attempts++` and a cap |
| chat_id collision | `UNIQUE(channel, external_id)` rejects; surface clear error |
| Digest > 4096 chars | Truncate + "view in app" |

---

## 12. Pros / Cons

### Pros
- **Reuses the mature notification core** (triggers, prefs table, digest assembly) — small new surface.
- **Abstraction kills the existing Resend triplication** and future-proofs Slack/Discord (the requirement) — new channel ≈ one file + enum + UI column.
- **Deep-link linking** = simplest UX, immediate DM capability, no OAuth/domain/widget setup.
- **Clean seams**: `NotificationChannel` + `ChannelLinker` + two generic tables.
- Telegram is free, instant, excellent mobile push.

### Cons / costs
- **New prod secret (bot token) + public inbound webhook + RLS-bypass writes** = Tier-3 attack surface to secure.
- **Near-real-time activities need a frequent cron** — genuinely new infra; per-event email isn't real-time today.
- **Migrating email into the interface touches half-wired-but-live email paths** → regression risk (invites, digest). Mitigate with tripwires.
- **Telegram constraints** (4096 chars, 1 msg/s per chat) → truncation + throttling logic.
- **Digest cron is currently unregistered** in vercel.json — must add; surfaces that digest may not run today.
- **Privacy/GDPR** obligations for storing chat_id (deletion/unlink flows).

---

## 13. Build decomposition (for execution, post-approval)

| Unit | Scope | Depends on | Parallel-safe |
|---|---|---|---|
| **U1** Migration | `user_channel_links` + `notification_deliveries` + indexes + RLS + Zod enum | — | — |
| **U2** Abstraction | `NotificationChannel`/`ChannelLinker` + registry; split `buildDigestModel`; wrap existing email as `EmailChannel` (no behavior change) | U1 | with U4 |
| **U3** Telegram transport | send client + HTML renderers (event+digest) + throttle | U2 | with U4 |
| **U4** Linking | `startTelegramLink`/`unlinkTelegram` + `/api/telegram/webhook` + setWebhook script | U1 | with U3 |
| **U5** Dispatcher cron | `/api/cron/send-notifications` looping channels + ledger; register digest cron | U2,U3 | — |
| **U6** Settings UI | Connect/Disconnect + digest toggle + TELEGRAM per-kind column; feature flag | U2,U4 | — |
| **U7** Verification | tripwires (email still sends: invite + digest), webhook idempotency, link expiry, blocked-bot | all | — |

**WIP limit: ≤2 unverified units in flight.** Each unit = its own commit, no smuggled refactors.

**Rollout:** feature flag `telegram_delivery_v1` → internal test (link own account) → cold-observer → ramp. (Note: flags are workspace-scoped jsonb but this is a per-user feature — gate UI exposure by flag; consider a global rollout flag instead. Small decision deferred to build.)

---

## 14. Open decisions deferred to build
1. Delivery ledger (`notification_deliveries`) vs. per-channel `*_sent_at` columns — design recommends ledger.
2. Frequent dispatcher cron interval (1 vs 5 min) — cost/latency.
3. Feature-flag scope (workspace jsonb vs global) for a per-user feature.
4. Whether to fully migrate email digest opt-in to `user_notification_prefs(kind='digest.daily')` or keep `profiles.email_digest_optin` bridged.
