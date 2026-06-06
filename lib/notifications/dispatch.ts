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

// Mirror lib/notifications/channels/email resolveEventCopy: actor display
// name + card/board titles.  Replicated minimally (the email resolver is not
// exported) so telegram renderEvent receives real titles instead of the
// "Someone" / empty fallbacks.
async function resolveEventCopy(
  sb: ReturnType<typeof getServiceSupabase>,
  n: Notif,
): Promise<{ actorName: string; cardTitle: string; boardTitle: string }> {
  let actorName = "Someone";
  if (n.actor_user_id) {
    const { data: ap } = await sb
      .from("profiles")
      .select("display_name")
      .eq("id", n.actor_user_id)
      .maybeSingle();
    if (ap?.display_name) actorName = ap.display_name;
  }
  let cardTitle = "";
  if (n.related_card_id) {
    const { data: c } = await sb
      .from("cards")
      .select("title")
      .eq("id", n.related_card_id)
      .maybeSingle();
    if (c?.title) cardTitle = c.title;
  }
  let boardTitle = "";
  if (n.related_board_id) {
    const { data: b } = await sb
      .from("boards")
      .select("title")
      .eq("id", n.related_board_id)
      .maybeSingle();
    if (b?.title) boardTitle = b.title;
  }
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

  // Terminal = a notification_deliveries row (channel='telegram') with status
  // IN ('sent','skipped').  Supabase JS has no NOT EXISTS, so we fetch the set
  // of terminal notification_ids and exclude them from the candidate select.
  // (Both queries are bounded; the ledger is sparse and the batch is <= limit.)
  const { data: terminalRows, error: termErr } = await sb
    .from("notification_deliveries")
    .select("notification_id")
    .eq("channel", CHANNEL)
    .in("status", ["sent", "skipped"]);
  if (termErr) throw termErr;
  const terminal = new Set(
    (terminalRows ?? []).map((r) => r.notification_id as string),
  );

  // Pull recent pending notifications (oldest first) and drop any already
  // terminal for telegram.  We over-fetch then filter so the terminal set
  // doesn't have to be embedded in the query.
  const { data: rows, error } = await sb
    .from("notifications")
    .select(
      "id, recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload, created_at",
    )
    .order("created_at", { ascending: true })
    .limit(limit + terminal.size);
  if (error) throw error;
  const pending = ((rows ?? []) as Notif[])
    .filter((n) => !terminal.has(n.id))
    .slice(0, limit);

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

      // Gate 1: user must have a linked telegram chat.
      const linked = await telegramChannel.isLinked(n.recipient_user_id);
      if (!linked) {
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
      const { data: pref } = await sb
        .from("user_notification_prefs")
        .select("enabled")
        .eq("user_id", n.recipient_user_id)
        .eq("kind", n.kind)
        .eq("channel", CHANNEL)
        .maybeSingle();
      const enabled = pref?.enabled ?? defaultExternalOn(n.kind);
      if (!enabled) {
        skipped++;
        await upsertLedger(sb, { notification_id: n.id, status: "skipped" });
        continue;
      }

      // Seam: resolve display names and inject into payload so telegram
      // renderEvent shows real actor/card/board copy.
      const { actorName, cardTitle, boardTitle } = await resolveEventCopy(sb, n);
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

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const link of links ?? []) {
    const userId = link.user_id as string;
    try {
      // Opt-in gate: explicit enabled=true digest.daily/telegram row required.
      const { data: pref } = await sb
        .from("user_notification_prefs")
        .select("enabled")
        .eq("user_id", userId)
        .eq("kind", "digest.daily")
        .eq("channel", CHANNEL)
        .maybeSingle();
      if (!pref || !pref.enabled) {
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
