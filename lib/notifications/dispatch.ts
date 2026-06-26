import { telegramChannel } from "@/lib/notifications/channels/telegram";
import type { TelegramSendResult } from "@/lib/notifications/channels/telegram/client";
import { buildDigestModel } from "@/lib/notifications/email-digest";
import type { NotificationRow } from "@/lib/notifications/channels/types";
import { defaultExternalOn } from "@/lib/notifications/kind-config";
import { getServiceSupabase } from "@/lib/supabase/service-role";

// Telegram delivery dispatcher (U5).  TELEGRAM-ONLY — email keeps its own
// cron (lib/notify-email.ts) so this path must NEVER send email (no
// double-send).  Mirrors the email send loop's name-resolution and per-kind
// opt-in pref gate, but persists state in the channel-neutral ledger
// (notification_deliveries) instead of email_sent_at.
//
// Idempotency: every per-event row gets a (notification_id, channel='telegram')
// ledger row.  A row whose status is TERMINAL — 'sent' or 'skipped' — excludes
// the notification from the next run (terminal-row filter below), and all
// ledger writes upsert onConflict (notification_id, channel).  So a second run
// is a no-op for anything already delivered or deliberately skipped.
//
// Service-role only: there is no user session in cron, and we look up
// recipient prefs / channel links / titles across users.  Never expose to
// the browser.

type Notif = NotificationRow;

const CHANNEL = "telegram" as const;

// Per-event display copy (actor name + card/board titles) assembled from
// batch-prefetched maps — see the prefetch block in dispatchTelegramNotifications.
// Mirrors the old per-row resolver's fallbacks: actor "Someone" when absent or
// unnamed, empty card/board title when absent.  Pure (no DB) so the send loop
// does ZERO name lookups per row.
function eventCopyFromMaps(
  n: Notif,
  actorNames: Map<string, string>,
  cardTitles: Map<string, string>,
  boardTitles: Map<string, string>,
): { actorName: string; cardTitle: string; boardTitle: string } {
  const actorName =
    (n.actor_user_id && actorNames.get(n.actor_user_id)) || "Someone";
  const cardTitle =
    (n.related_card_id && cardTitles.get(n.related_card_id)) || "";
  const boardTitle =
    (n.related_board_id && boardTitles.get(n.related_board_id)) || "";
  return { actorName, cardTitle, boardTitle };
}

// Upsert one ledger row keyed (notification_id, 'telegram').  onConflict keeps
// the run idempotent: re-stamping a row is a no-op-equivalent write.
async function upsertLedger(
  sb: ReturnType<typeof getServiceSupabase>,
  row: {
    notification_id: string;
    status: "sent" | "skipped" | "failed";
    sent_at?: string | null;
    error?: string | null;
    attempts?: number;
  },
): Promise<void> {
  await sb
    .from("notification_deliveries")
    .upsert(
      {
        notification_id: row.notification_id,
        channel: CHANNEL,
        status: row.status,
        ...(row.sent_at !== undefined ? { sent_at: row.sent_at } : {}),
        ...(row.error !== undefined ? { error: row.error } : {}),
        ...(row.attempts !== undefined ? { attempts: row.attempts } : {}),
      },
      { onConflict: "notification_id,channel" },
    );
}

// Read the current attempts count for a (notification, telegram) ledger row so
// a 'failed' write can bump it.  Absent row -> 0.
async function currentAttempts(
  sb: ReturnType<typeof getServiceSupabase>,
  notificationId: string,
): Promise<number> {
  const { data } = await sb
    .from("notification_deliveries")
    .select("attempts")
    .eq("notification_id", notificationId)
    .eq("channel", CHANNEL)
    .maybeSingle();
  return typeof data?.attempts === "number" ? data.attempts : 0;
}

// Bot blocked/kicked by the user (HTTP 403 -> { blocked: true } from the
// client).  Revoke the user's telegram link so we stop trying.
async function revokeLink(
  sb: ReturnType<typeof getServiceSupabase>,
  userId: string,
): Promise<void> {
  await sb
    .from("user_channel_links")
    .update({ status: "revoked" })
    .eq("user_id", userId)
    .eq("channel", CHANNEL);
}

export type DispatchResult = { sent: number; skipped: number; failed: number };

// Core per-event loop.  Selects recent pending notifications WITHOUT a terminal
// telegram ledger row, resolves names, gates on link + per-kind pref, sends via
// telegramChannel, and records the outcome in the ledger.
export async function dispatchTelegramNotifications(
  { limit = 200 }: { limit?: number } = {},
): Promise<DispatchResult> {
  const sb = getServiceSupabase();

  // Candidate selection.  Pull the `limit` MOST RECENT notifications, then look
  // up terminal telegram ledger rows for ONLY those candidates.  Both queries
  // are bounded by `limit` (<= 200), so neither can hit the PostgREST 1000-row
  // cap that previously hid freshly-created notifications: the old code fetched
  // the GLOBAL terminal set (capped at 1000) and sized an oldest-first window
  // from it (`limit + terminal.size`), so once the table held more than
  // limit+1000 rows the newest notifications fell outside the window and were
  // never sent.  We reverse the newest batch to oldest-first to preserve the
  // prior in-batch processing order.
  const { data: rows, error } = await sb
    .from("notifications")
    .select(
      "id, recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const candidates = ((rows ?? []) as Notif[]).slice().reverse();

  // Terminal = a notification_deliveries row (channel='telegram') with status
  // IN ('sent','skipped') for one of THESE candidates.  Scoping the lookup to
  // the candidate ids keeps it bounded (<= limit) and cap-proof — Supabase JS
  // has no NOT EXISTS, so we fetch the terminal subset and exclude it.
  const candidateIds = candidates.map((n) => n.id);
  const terminal = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: terminalRows, error: termErr } = await sb
      .from("notification_deliveries")
      .select("notification_id")
      .eq("channel", CHANNEL)
      .in("status", ["sent", "skipped"])
      .in("notification_id", candidateIds);
    if (termErr) throw termErr;
    for (const r of terminalRows ?? []) {
      terminal.add(r.notification_id as string);
    }
  }
  const pending = candidates.filter((n) => !terminal.has(n.id));

  // Gate 0 data: resolve the master "Notify me on every event" toggle
  // (profiles.notify_per_event, default FALSE) for every DISTINCT recipient in
  // this batch in ONE query.  A recipient is "master-on" iff their row is
  // explicitly true; absent/false => off.  This is the master gate that runs
  // before isLinked and before the per-kind pref — per-event telegram delivery
  // does not run at all for a recipient whose master is off.
  const recipientIds = [...new Set(pending.map((n) => n.recipient_user_id))];
  const masterOn = new Set<string>();
  if (recipientIds.length > 0) {
    const { data: profileRows, error: profErr } = await sb
      .from("profiles")
      .select("id, notify_per_event")
      .in("id", recipientIds);
    if (profErr) throw profErr;
    for (const p of profileRows ?? []) {
      if (p.notify_per_event === true) masterOn.add(p.id as string);
    }
  }

  // Batch-load the remaining per-row reads ONCE for the whole batch, replacing
  // the old per-iteration isLinked / pref / name lookups (the N+1).  Mirrors the
  // masterOn batch above: one query per concern, keyed maps the loop reads from.

  // Linked telegram chats: a user is linked iff a user_channel_links row exists
  // with status='linked' and a non-empty external_id (chat id) — the same
  // predicate resolveChatId enforces inside the channel.
  const linkedIds = new Set<string>();
  if (recipientIds.length > 0) {
    const { data: linkRows, error: linkErr } = await sb
      .from("user_channel_links")
      .select("user_id, external_id")
      .in("user_id", recipientIds)
      .eq("channel", CHANNEL)
      .eq("status", "linked");
    if (linkErr) throw linkErr;
    for (const r of linkRows ?? []) {
      if (typeof r.external_id === "string" && r.external_id) {
        linkedIds.add(r.user_id as string);
      }
    }
  }

  // Per-(kind, channel='telegram') opt-in prefs, keyed `${user_id}::${kind}`.
  // An ABSENT key falls back to defaultExternalOn(kind) at read time in the loop;
  // an explicit row (true OR false) wins — identical to the old `pref?.enabled ??`.
  const kinds = [...new Set(pending.map((n) => n.kind))];
  const prefMap = new Map<string, boolean>();
  if (recipientIds.length > 0 && kinds.length > 0) {
    const { data: prefRows, error: prefErr } = await sb
      .from("user_notification_prefs")
      .select("user_id, kind, enabled")
      .in("user_id", recipientIds)
      .in("kind", kinds)
      .eq("channel", CHANNEL);
    if (prefErr) throw prefErr;
    for (const p of prefRows ?? []) {
      prefMap.set(
        `${p.user_id as string}::${p.kind as string}`,
        p.enabled as boolean,
      );
    }
  }

  // Display-copy maps.  Only TRUTHY values are stored so eventCopyFromMaps'
  // "Someone"/"" fallbacks fire for absent OR empty rows (matches the old code).
  const actorIds = [
    ...new Set(
      pending.map((n) => n.actor_user_id).filter((v): v is string => !!v),
    ),
  ];
  const cardIds = [
    ...new Set(
      pending.map((n) => n.related_card_id).filter((v): v is string => !!v),
    ),
  ];
  const boardIds = [
    ...new Set(
      pending.map((n) => n.related_board_id).filter((v): v is string => !!v),
    ),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profileRows, error: pErr } = await sb
      .from("profiles")
      .select("id, display_name")
      .in("id", actorIds);
    if (pErr) throw pErr;
    for (const p of profileRows ?? []) {
      if (p.display_name) actorNames.set(p.id as string, p.display_name as string);
    }
  }
  const cardTitles = new Map<string, string>();
  if (cardIds.length > 0) {
    const { data: cardRows, error: cErr } = await sb
      .from("cards")
      .select("id, title")
      .in("id", cardIds);
    if (cErr) throw cErr;
    for (const c of cardRows ?? []) {
      if (c.title) cardTitles.set(c.id as string, c.title as string);
    }
  }
  const boardTitles = new Map<string, string>();
  if (boardIds.length > 0) {
    const { data: boardRows, error: bErr } = await sb
      .from("boards")
      .select("id, title")
      .in("id", boardIds);
    if (bErr) throw bErr;
    for (const b of boardRows ?? []) {
      if (b.title) boardTitles.set(b.id as string, b.title as string);
    }
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const n of pending) {
    try {
      // Gate 0 (MASTER): the "Notify me on every event" toggle
      // (profiles.notify_per_event, default FALSE) gates the per-event path on
      // EXTERNAL channels.  It is now ENFORCED HERE, ahead of isLinked and the
      // per-kind pref: a recipient whose master is off gets NO per-event
      // telegram send, even when linked and even for a Tier-1 default-on kind.
      // (The daily digest is intentionally master-independent and lives in
      // dispatchTelegramDigests, which does not run this gate.)
      if (!masterOn.has(n.recipient_user_id)) {
        skipped++;
        await upsertLedger(sb, { notification_id: n.id, status: "skipped" });
        continue;
      }

      // Gate 1: user must have a linked telegram chat (from the prefetched set).
      if (!linkedIds.has(n.recipient_user_id)) {
        skipped++;
        await upsertLedger(sb, { notification_id: n.id, status: "skipped" });
        continue;
      }

      // Gate 2: per-(kind, channel='telegram') tiered opt-in.  An EXPLICIT pref
      // row wins in both directions; an ABSENT row falls back to the kind's
      // tiered default (Tier 1 => on, Tier 2/3 => off).  This is the honest half
      // of the invariant — the settings matrix pre-checks the telegram cell with
      // the SAME `defaultExternalOn(kind)`, so a checked-by-default box really
      // sends and an unchecked one really doesn't.  This is the LAST gate: the
      // master `notify_per_event` toggle (Gate 0) and isLinked (Gate 1) have
      // already run above, so reaching here means the recipient opted into
      // per-event delivery AND has a linked chat.
      const prefEnabled = prefMap.get(`${n.recipient_user_id}::${n.kind}`);
      const enabled = prefEnabled ?? defaultExternalOn(n.kind);
      if (!enabled) {
        skipped++;
        await upsertLedger(sb, { notification_id: n.id, status: "skipped" });
        continue;
      }

      // Seam: resolve display names (from the prefetched maps) and inject into
      // payload so telegram renderEvent shows real actor/card/board copy.
      const { actorName, cardTitle, boardTitle } = eventCopyFromMaps(
        n,
        actorNames,
        cardTitles,
        boardTitles,
      );
      const enriched: Notif = {
        ...n,
        payload: {
          ...(n.payload ?? {}),
          actor_name: actorName,
          ...(cardTitle ? { card_title: cardTitle } : {}),
          ...(boardTitle ? { board_title: boardTitle } : {}),
        },
      };

      const result = (await telegramChannel.sendEvent(n.recipient_user_id, {
        notification: enriched,
      })) as TelegramSendResult;

      if (result.status === "sent") {
        sent++;
        await upsertLedger(sb, {
          notification_id: n.id,
          status: "sent",
          sent_at: new Date().toISOString(),
          error: null,
        });
        continue;
      }

      // "skipped" here means the channel found no linked chat between our
      // isLinked check and the send (race / just-revoked).  Treat as skip.
      if (result.status === "skipped") {
        skipped++;
        await upsertLedger(sb, { notification_id: n.id, status: "skipped" });
        continue;
      }

      // failed — record error + bump attempts (NON-terminal so it retries).
      failed++;
      const attempts = (await currentAttempts(sb, n.id)) + 1;
      await upsertLedger(sb, {
        notification_id: n.id,
        status: "failed",
        error: result.error ?? "send failed",
        attempts,
      });

      // Blocked by the user -> revoke the link so we stop retrying.
      if (result.blocked) {
        await revokeLink(sb, n.recipient_user_id);
      }
    } catch (err) {
      failed++;
      console.error("[telegram-dispatch] row failed", n.id, err);
    }
  }

  return { sent, skipped, failed };
}

// Daily digest fan-out for telegram.  For each linked telegram user whose
// digest.daily/telegram pref is enabled, build the channel-neutral digest model
// and send it.  No ledger (digests are idempotent enough at daily cadence and
// the email path likewise doesn't ledger them).
export async function dispatchTelegramDigests(): Promise<DispatchResult> {
  const sb = getServiceSupabase();

  const { data: links, error } = await sb
    .from("user_channel_links")
    .select("user_id")
    .eq("channel", CHANNEL)
    .eq("status", "linked");
  if (error) throw error;

  // Batch the digest opt-in gate: ONE query for every linked user's explicit
  // enabled=true digest.daily/telegram pref (was one query per user, the N+1).
  // Membership in the set == opted in; absent OR enabled=false == out, matching
  // the old per-row `!pref || !pref.enabled`.
  const userIds = [...new Set((links ?? []).map((l) => l.user_id as string))];
  const digestEnabled = new Set<string>();
  if (userIds.length > 0) {
    const { data: prefRows, error: prefErr } = await sb
      .from("user_notification_prefs")
      .select("user_id, enabled")
      .in("user_id", userIds)
      .eq("kind", "digest.daily")
      .eq("channel", CHANNEL);
    if (prefErr) throw prefErr;
    for (const p of prefRows ?? []) {
      if (p.enabled) digestEnabled.add(p.user_id as string);
    }
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const link of links ?? []) {
    const userId = link.user_id as string;
    try {
      // Opt-in gate: explicit enabled=true digest.daily/telegram row required
      // (from the prefetched set above).
      if (!digestEnabled.has(userId)) {
        skipped++;
        continue;
      }

      const model = await buildDigestModel(userId, { sb });
      if (!model) {
        skipped++;
        continue;
      }

      const result = (await telegramChannel.sendDigest(
        userId,
        model,
      )) as TelegramSendResult;
      if (result.status === "sent") {
        sent++;
      } else if (result.status === "skipped") {
        skipped++;
      } else {
        failed++;
        if (result.blocked) await revokeLink(sb, userId);
      }
    } catch (err) {
      failed++;
      console.error("[telegram-dispatch] digest failed", userId, err);
    }
  }

  return { sent, skipped, failed };
}
