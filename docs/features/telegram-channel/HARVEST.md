# Telegram Channel — Harvest (lessons + invariants)

Date: 2026-06-06. Closes the ai-dev-control loop for the Telegram channel feature.

## Process misses → repairs (so they don't recur)

| Phase that missed | What happened | Repair (codified) |
|---|---|---|
| **Recon** | The `channel` value allow-list is a raw-SQL `CHECK` constraint (migration 0026), invisible in `schema.ts`. U1 "added telegram" but the DB still rejected it → cost migration 0125. | Recon rule: when a task adds an *allowed value*, `grep` migrations for `check(` / `ARRAY[` — don't trust the Drizzle schema for value constraints. |
| **Build/test hygiene** (recurred ×3: 0123 history, U5 self-widen, U6a self-add) | Builders mutated the shared local DB schema in test `beforeAll` to compensate for a not-yet-applied migration → migration-history drift + failed runner applies. | Handoff rule: **never alter shared DB schema inside tests.** The orchestrator applies migrations first; tests assume the migrated DB. |
| **Verify** | Handler-level integration tests call route functions directly, bypassing middleware → missed that the webhook was 401'd by the auth middleware. | A public `/api/*` endpoint needs a **real-HTTP** test (or a live check), not just a handler test. |
| **Spec/wiring** | The master "Notify me on every event" toggle was stored but never read by the dispatcher → decorative; every linked user got Tier-1 pings regardless. | Invariant: **a settings toggle is not a gate until enforced at the delivery layer.** |
| **Scope** | A builder added `kind-config` + default-on pre-checking + 16 kinds unprompted → boxes shown checked while nothing sent (lying controls). | Builders must not broaden scope; **a pre-checked box must correspond to real delivery** (honest-wiring invariant below). |

## New invariants (future Must-not-change lines)
1. **Honest-wiring:** the UI per-kind default and the dispatcher per-kind default read the **same** source (`lib/notifications/kind-config.ts` → `defaultExternalOn`). A checked-by-default box must actually deliver.
2. Adding a channel value ⇒ widen `user_notification_prefs_channel_check` (migration).
3. A new public `/api/*` route ⇒ add to `CRON_API_PATHS_EXACT` **and** self-authenticate in the handler.
4. Vercel cron auth = `Authorization: Bearer $CRON_SECRET` (not a custom header) — `digest` route now accepts both.
5. A user-facing toggle must be enforced at the delivery layer, not just persisted.
6. Telegram-only dispatcher must never loop the email channel (no double-send); email keeps its own cron.

## Regression tripwires (now guarding)
- Invite email still sends (`tests/unit/invite-email.test.ts`, invite integration) — protects the U2 email refactor.
- Master OFF → no external per-event (`telegram-dispatch.test.ts`).
- Tiered defaults honored in UI **and** dispatcher (`kind-config.test.ts` + dispatch tests).
- Webhook self-auth + link (`telegram-webhook.test.ts`).

## Reusable seam (future chat apps)
`NotificationChannel` + `ChannelLinker` + the `notification_deliveries` ledger + `kind-config` SSOT mean a new channel (Slack/Discord) ≈ one channel file + one linker + a `ChannelId`/Zod enum entry + a settings column. No changes to triggers, digest assembly, dispatcher loop, or prefs schema. See DESIGN.md §10.

## Known follow-ups / deploy notes
- **Restart `npm run dev`** to pick up the new routes (the cron 500 observed locally was a stale dev server; `build` + isolated dispatch both pass).
- **setWebhook** needs a public HTTPS URL (tunnel/deploy) for the real Telegram→webhook hop; handler is proven via direct POST + a real link.
- Confirm `CRON_SECRET` is set in Vercel env (both crons) before relying on scheduled delivery.
- Per-event Telegram cron is **daily** (chosen); near-real-time would need a Pro-plan `*/5` cron.
- Email per-event channel remains intentionally unwired (`availability.ts` skips it); its settings column is greyed.
- **Rotate the bot token** (committed to `.env.local.example` per request) before any shared/public push.
- Local test state left behind: `team@innovina.it` has master ON + a linked Telegram (Paul) + one delivered test notification.
