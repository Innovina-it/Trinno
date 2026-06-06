# U6 Addendum — "Notify me on every event" Master Toggle (design contract)

Status: **CONTRACT / ready for U6 implementation** (no code yet)
Provenance: folded in from an ai-dev-control unit (settings-notifications cleanup).
Owner: **whoever implements telegram U6** (Settings UI). Single owner of the
settings page to avoid file clobber.
Date: 2026-06-05

> This file is a hand-off contract, not a competing design. It specifies the
> master per-event toggle that replaces the current **dead** control at
> `app/(app)/settings/notifications/page.tsx:53` (`id="email-instant"` — an
> `<input>` with no handler that persists nothing). Implement it as part of
> U6 alongside the Telegram channel column and connect flow.

---

## 1. Locked decisions

| Decision | Value | Rationale |
|---|---|---|
| Storage | `profiles.notify_per_event boolean NOT NULL DEFAULT false` | Mirrors `profiles.email_digest_optin`; notification-domain home; owner-RLS already exists (0003). |
| Default | **OFF** for all users (existing + new) | Cannot deliver today (email unwired, telegram not yet linked) → off is the only honest default. |
| Semantics | Gates **external** channels only (email + telegram) | In-app bell/inbox stays always-on (source of truth); daily digest unaffected. |
| Enable precondition | **Toggle is disabled until ≥1 external channel can deliver** | Email send is broken; so today the only path to enable is a linked Telegram account. No lying controls. |

---

## 2. Options matrix (telegram-inclusive)

| # | Setting | Section | Controls | Storage | Status |
|---|---|---|---|---|---|
| 1 | In-app | Channels | bell + inbox, always on | implicit | exists |
| 2 | **Notify me on every event** (MASTER) | Delivery | gates per-event delivery on external channels; disabled until a channel is linked; default OFF | `profiles.notify_per_event` *(new)* | **build in U6** |
| 3 | Email daily digest | Delivery | batched email | `profiles.email_digest_optin` | exists — **leave as-is** |
| 4 | Telegram daily digest | Delivery | batched TG | `user_notification_prefs` kind=`digest.daily` ch=`telegram` | telegram U6 |
| 5 | Connect / Disconnect Telegram | Channels | account link | `user_channel_links` | telegram U4/U6 |
| 6 | per-kind × In-app | Events | in-app per kind | `user_notification_prefs` | exists |
| 7 | per-kind × Email | Events | email per kind | `user_notification_prefs` | exists — **leave as-is** |
| 8 | per-kind × Telegram | Events | TG per kind | `user_notification_prefs` ch=`telegram` | telegram U6 |

---

## 3. Page mockup — `/settings/notifications`

### State A — no channel connected (master disabled)
```
CHANNELS
  In-app          Always on                      [locked]
  Email           <user email>         delivery not active
  Telegram        Not connected            [ Connect > ]

DELIVERY
  Notify me on every event                    [ OFF ]  (i)   <- disabled
     Instant per-event pings on your connected channels.
     (i) Connect Telegram to enable — email delivery isn't active yet.

  Email daily digest                          [ OFF ]
  Telegram daily digest                       (connect first)

EVENTS                            IN-APP    EMAIL    TELEGRAM
  Mention in a comment             [x]       [ ]       ( - )
  New comment                      [x]       [ ]       ( - )
  Card assigned to you             [x]       [ ]       ( - )
  Card due                         [x]       [ ]       ( - )
  Card dates changed               [x]       [ ]       ( - )
  Card archived                    [x]       [ ]       ( - )
  Card completed                   [x]       [ ]       ( - )
  Added to a board                 [x]       [ ]       ( - )
      (email column unchanged; telegram column greyed until linked)
```

### State B — Telegram connected (master live)
```
CHANNELS
  Telegram        @handle  ·  Connected         [ Disconnect ]
DELIVERY
  Notify me on every event                     [ ON ]        <- now enable-able
EVENTS                            IN-APP    EMAIL    TELEGRAM
  Mention in a comment             [x]       [ ]       [x]    <- TG column live
  ...
```
Master OFF in State B → EMAIL + TELEGRAM columns grey out; IN-APP stays live.

---

## 4. Data model addition

Fold the column into the telegram migration (single feature now) **or** ship a
dedicated follow-on. Recommended: include in the telegram migration so the whole
settings feature lands atomically.

```sql
-- within the telegram migration (e.g. 0124_telegram_channel.sql) or a sibling
ALTER TABLE public.profiles
  ADD COLUMN notify_per_event boolean NOT NULL DEFAULT false;
```
No backfill (default covers existing rows). No new RLS (profiles RLS from 0003
already scopes owner read/write). Drizzle: add to `profiles` in `lib/db/schema.ts`
next to `emailDigestOptin`.

⚠️ **Migration numbering:** telegram DESIGN.md pencils `0124`. If both the
telegram tables and this column ship together, one migration file is fine.
If split, this column takes the next free number. Latest on disk is `0123`.

---

## 5. Gating predicate

Single source of truth for "can the user receive external per-event delivery
right now". Build alongside the channel registry (DESIGN.md §3).

```ts
// lib/notifications/channels/availability.ts
import { channels } from "./registry";

/** True when at least one external channel can actually deliver to this user.
 *  Email is excluded until its send path is wired (today: false).
 *  Telegram counts once user_channel_links.status = 'linked'. */
export async function hasExternalDeliveryChannel(userId: string): Promise<boolean> {
  for (const c of channels) {
    if (c.id === "email") continue;          // delivery not wired — see DESIGN.md §2
    if (await c.isLinked(userId)) return true;
  }
  return false;
}
```
When the email send path is wired later, drop the `email` skip.

---

## 6. Server actions

Mirror `getEmailDigestPref` / `setEmailDigestPref` in
`actions/user-notification-prefs.ts`.

```ts
export async function getNotifyPerEvent(): Promise<boolean> {
  // requireUser -> decodeSub(jwt) -> dbAsUser
  // select profiles.notify_per_event where id = userId; return row?.value ?? false
}

export async function setNotifyPerEvent(enabled: boolean): Promise<void> {
  // z.boolean().parse(enabled)
  // GUARD: if (enabled && !(await hasExternalDeliveryChannel(userId)))
  //          throw StructuredError VALIDATION_ERROR "No delivery channel connected"
  // update profiles set notify_per_event = enabled where id = userId
  // revalidatePath("/settings/notifications")
}
```
The server-side guard is mandatory — the client disabled-state is UX only; the
action must refuse `enabled=true` when no channel can deliver.

---

## 7. UI component

Replace the dead `email-instant` row with a real client component
(`components/settings/notify-per-event-toggle.tsx`), server-rendered initial
value like `EmailDigestToggle`.

Props: `initial: boolean`, `channelAvailable: boolean` (from
`hasExternalDeliveryChannel` on the server page).

Behavior:
- `channelAvailable === false` → checkbox **disabled**, label
  "Notify me on every event", hint "Connect Telegram to enable — email
  delivery isn't active yet." Never persists in this state.
- `channelAvailable === true` → live; optimistic toggle + `setNotifyPerEvent`;
  rollback + `toast.error` on failure (same pattern as `EmailDigestToggle`).
- Delete the `id="email-instant"` `PrefRow` from the page entirely.

Matrix coupling: when master is OFF (or `channelAvailable === false`), the
EMAIL + TELEGRAM columns in `NotificationPrefsForm` render greyed/disabled; the
IN-APP column stays interactive. (Email column visuals greyed only — do not
change its persistence semantics.)

---

## 8. Must-not-change invariants

- Email per-event **matrix column** persistence — unchanged.
- Email daily digest (`profiles.email_digest_optin`) — unchanged.
- In-app bell/inbox — always-on, unchanged.
- `user_notification_prefs(kind, channel, enabled)` semantics — unchanged.
- Notification DB triggers — unchanged.
- No control on the page may persist nothing while appearing active (the bug
  this contract fixes).

---

## 9. Acceptance criteria (verification tripwires)

1. `profiles.notify_per_event` exists, default false; existing rows read false.
2. With no channel linked: toggle is disabled, shows the hint, persists nothing;
   `setNotifyPerEvent(true)` server action **throws** (guard holds).
3. After linking Telegram: toggle enables; on→off→on round-trips through the DB.
4. Master OFF greys EMAIL + TELEGRAM columns; IN-APP stays interactive.
5. Regression: invite email still sends; existing in-app + email matrix toggles
   still persist; digest opt-in unchanged.
6. No `id="email-instant"` element remains in the DOM.

---

## 10. Per-kind catalogue — expose all 16, priority-ordered, important-on-by-default

**Requested change:** the EVENTS matrix today exposes only 8 of the 16 sendable
kinds (`app/(app)/settings/notifications/page.tsx` `KIND_DESCRIPTIONS`). The
other 8 have no UI control. Expose **all 16**, ordered by priority, with the
most important pre-enabled for external channels.

### 10.1 Source of truth (already written)
`lib/notifications/kind-config.ts` exports `NOTIFICATION_KINDS: KindConfig[]` —
all 16 kinds (matches `notifications_kind_check`, migration 0087), in priority
order, each with a `tier` (1–3) and `defaultExternalOn`. Both the settings page
and the dispatcher import it. Do **not** re-declare the kind list elsewhere.

| Tier | Kinds | External default |
|---|---|---|
| **1 — direct & actionable** | `comment.mention`, `card.assigned`, `card.owner_assigned`, `card.due`, `board.member.added` | **ON** |
| **2 — relevant, not urgent** | `comment.create`, `card.completed`, `card.dates`, `card.unassigned`, `card.owner_unassigned`, `card.sprint_changed`, `card.moved` | OFF |
| **3 — informational** | `card.label.added`, `card.linked`, `card.archived`, `card.unarchived` | OFF |

### 10.2 Default policy — ⚠️ this changes the dispatcher's current gate
The per-event dispatcher (`lib/notifications/dispatch.ts:173-182`) currently
uses **strict opt-in for telegram**: *"an explicit `enabled=true` row is
required; absence = skip."* So today all 16 telegram kinds default OFF. The
request ("important kinds true by default") requires the default to come from
`defaultExternalEnabled(kind)` instead of being hard-OFF. Two ways to satisfy
it — pick one at build:

- **Option A (recommended): config-driven default.** When no pref row exists,
  apply `defaultExternalEnabled(kind)` in **both** places — the matrix render
  (form's `emailOn`/`telegramOn` initial state) **and** the dispatcher gate
  (replace the `absence ⇒ skip` branch). One policy, no seed rows. Cost:
  touches the gate the dispatcher just shipped — coordinate, and re-run
  `tests/integration/telegram-dispatch.test.ts` (it asserts absence ⇒ skip).
- **Option B: seed rows.** Keep the strict gate; on first link (or via a
  backfill) insert `enabled=true` rows for the Tier-1 kinds × {email, telegram}.
  Lower blast radius (no gate change) but creates "phantom" pref rows and needs
  a seeding hook. Rejected unless changing the gate proves risky.

**Safety — ⚠️ requires a server-side master gate that does NOT exist yet.**
The intended guarantee is: external per-event delivery is globally gated by
`profiles.notify_per_event` (default OFF, §1), so a Tier-1 `true` default only
**pre-checks the box** and nothing sends until the user enables the master and
links a channel. **But `lib/notifications/dispatch.ts` currently checks only
link + per-kind pref — it never reads `notify_per_event`.** Under today's strict
opt-in (absence ⇒ skip) that is harmless, but the moment a kind defaults ON the
absence path starts sending. **Option A is therefore only safe if it ALSO adds
the master gate to the dispatcher** (see §11, step 2). Without it, Tier-1 sends
to any linked user regardless of the master toggle.

### 10.3 Matrix presentation
- Render the 16 rows in `NOTIFICATION_KINDS` order. Optionally group with the
  tier label as a sub-heading (`DIRECT` / `UPDATES` / `INFORMATIONAL`) so the
  longer list stays scannable.
- in-app column: unchanged (absence ⇒ ON, all 16).
- email + telegram columns: initial checked state = explicit row if present,
  else `defaultExternalEnabled(kind)`.

### 10.4 Acceptance additions
7. All 16 `NOTIFICATION_KINDS` render in the EVENTS matrix, in tier order.
8. With no pref rows: Tier-1 kinds show **checked** on email + telegram columns;
   Tier-2/3 show unchecked; in-app all checked.
9. Dispatcher honors the same default (Option A): a linked user with master ON
   and no pref rows receives Tier-1 kinds on telegram and not Tier-2/3.
   `telegram-dispatch.test.ts` updated to the new default policy.

---

## 11. Option A — implementation recipe (execute in order)

Config SSOT already exists: `lib/notifications/kind-config.ts`
(`NOTIFICATION_KINDS`, `defaultExternalEnabled(kind)`). All edits below consume
it. Each step = its own commit; keep WIP ≤2 per the DESIGN.md rule.

### Step 1 — dispatcher: per-kind default from config
File: `lib/notifications/dispatch.ts`.

1a. Add import at top:
```ts
import { defaultExternalEnabled } from "@/lib/notifications/kind-config";
```
1b. Replace **Gate 2** (currently lines ~173–186, the `absence ⇒ skip` block):
```ts
      // Gate 2: per-(kind, channel) preference.  Explicit row wins; absence
      // falls back to the kind's config default (Tier-1 kinds default ON).
      const { data: pref } = await sb
        .from("user_notification_prefs")
        .select("enabled")
        .eq("user_id", n.recipient_user_id)
        .eq("kind", n.kind)
        .eq("channel", CHANNEL)
        .maybeSingle();
      const kindEnabled = pref ? pref.enabled : defaultExternalEnabled(n.kind);
      if (!kindEnabled) {
        skipped++;
        await upsertLedger(sb, { notification_id: n.id, status: "skipped" });
        continue;
      }
```

### Step 2 — dispatcher: ADD the master gate (correctness, not optional)
Same file. Without this, default-ON kinds send even when the user never enabled
"Notify me on every event".

2a. Before the `for (const n of pending)` loop, add a per-batch cache:
```ts
  const masterCache = new Map<string, boolean>();
```
2b. Add a helper (next to `resolveEventCopy`):
```ts
// Gate 0 source: the per-user master "Notify me on every event" switch
// (profiles.notify_per_event, default false). Cached per recipient per batch.
async function masterEnabled(
  sb: ReturnType<typeof getServiceSupabase>,
  userId: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit !== undefined) return hit;
  const { data } = await sb
    .from("profiles")
    .select("notify_per_event")
    .eq("id", userId)
    .maybeSingle();
  const on = data?.notify_per_event === true;
  cache.set(userId, on);
  return on;
}
```
2c. Inside the loop, as **Gate 0** (before the existing link check at ~166):
```ts
      // Gate 0: master per-event switch. No external per-event delivery unless
      // the user enabled "Notify me on every event".
      if (!(await masterEnabled(sb, n.recipient_user_id, masterCache))) {
        skipped++;
        await upsertLedger(sb, { notification_id: n.id, status: "skipped" });
        continue;
      }
```

### Step 3 — settings matrix: expose all 16 + config-driven external defaults
File: `components/settings/notification-prefs-form.tsx`.

3a. Import the helper and the config type:
```ts
import { defaultExternalEnabled } from "@/lib/notifications/kind-config";
import type { KindConfig } from "@/lib/notifications/kind-config";
```
3b. Accept `KindConfig[]` (drop the local `Kind` type, or keep it as an alias):
`export function NotificationPrefsForm({ kinds }: { kinds: KindConfig[] }) {`
3c. Replace the per-channel initial-state lines:
```ts
        // in-app: absence ⇒ ON. external: absence ⇒ config default.
        const inAppOn = inApp[k.kind] !== false;
        const emailOn = email[k.kind] ?? defaultExternalEnabled(k.kind);
```
3d. When the **telegram column** lands (U6 channel work), mirror it:
`const tgOn = telegram[k.kind] ?? defaultExternalEnabled(k.kind);`
and persist with `setNotificationPref({ kind, channel: "telegram", enabled })`.

### Step 4 — settings page: pass the 16, drop the hand-rolled 8
File: `app/(app)/settings/notifications/page.tsx`.

4a. Replace the `KIND_DESCRIPTIONS` block (the 8-kind `.map`) and its
`EMAIL_KIND_LABELS` import with:
```ts
import { NOTIFICATION_KINDS } from "@/lib/notifications/kind-config";
```
4b. Render: `<NotificationPrefsForm kinds={NOTIFICATION_KINDS} />`.
4c. (Optional) group rows by `tier` with sub-headings DIRECT / UPDATES /
INFORMATIONAL for scannability.

### Step 5 — update tests
File: `tests/integration/telegram-dispatch.test.ts`.

The suite currently uses `card.assigned` (now **Tier-1, default ON**) and
asserts "no pref row ⇒ skipped". That inverts under A. Required changes:
- Add a helper `setMaster(userId, on)` upserting `profiles.notify_per_event`.
- Every existing **"sent"** test must first `setMaster(recipient, true)`
  (Gate 0 now applies).
- Replace the "no pref row ⇒ skipped" case (~line 256) with three cases:
  1. master ON + linked + **no row** + Tier-1 (`card.assigned`) ⇒ **sent**.
  2. master ON + linked + **no row** + Tier-3 (`card.archived`) ⇒ **skipped**.
  3. master ON + linked + explicit `enabled=false` (any kind) ⇒ **skipped**.
- Add: master **OFF** + linked + Tier-1 + no row ⇒ **skipped** (Gate 0 holds).

Also extend `tests/integration/notify-per-event.test.ts` if it should assert the
dispatcher honors the master gate end-to-end.

### Step 6 — verify
- `tsc` clean (config types flow through form + page).
- Run `telegram-dispatch.test.ts` + `notify-per-event.test.ts` green.
- Manual: link a test account, master OFF ⇒ no telegram on any event; master ON
  ⇒ Tier-1 events arrive, Tier-3 do not, until their box is ticked.
- Regression tripwire: in-app matrix + email digest opt-in unchanged.

### Files touched (ownership note)
`dispatch.ts`, `notification-prefs-form.tsx`, `page.tsx`,
`telegram-dispatch.test.ts` (+ maybe `notify-per-event.test.ts`). All in the
telegram feature's U5/U6 surface — safe to edit now that the implementing agent
is stopped; if it resumes, this recipe is the contract it should follow.
