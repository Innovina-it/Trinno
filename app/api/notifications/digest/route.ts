import { NextResponse } from "next/server";
import { emailChannel } from "@/lib/notifications/channels/email";
import { buildDigestModel } from "@/lib/notifications/email-digest";
import { dispatchTelegramDigests } from "@/lib/notifications/dispatch";
import { getServiceSupabase } from "@/lib/supabase/service-role";

// Daily digest cron handler.  Loops every user with email_digest_optin =
// true, builds a digest from the last 24h of unsent notifications, sends
// via the email channel (Resend), then stamps email_sent_at on the
// included rows so the per-event sender doesn't double-send them.
//
// Auth (DUAL): a request authorizes if EITHER credential matches —
//   1. `Authorization: Bearer ${CRON_SECRET}` — what Vercel's cron service
//      sends automatically (same Bearer pattern as
//      /api/cron/send-notifications).  This is the path Vercel uses in prod;
//      without it the registered digest cron would 401.
//   2. `x-cron-key === ${CRON_KEY}` — the original header, kept for
//      back-compat with any external/self-hosted cron already POSTing it.
// Dev-skip behavior is preserved: if NEITHER CRON_SECRET nor CRON_KEY is set
// (typical local dev), auth is skipped so a developer can curl the route.
//
// Schedule: target 09:00 UTC.  For Vercel, add to `vercel.json`:
//   { "path": "/api/notifications/digest", "schedule": "0 9 * * *" }
// For self-hosted, run an external cron that POSTs with one of the headers.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const cronKey = process.env.CRON_KEY;
  // Skip auth only when NEITHER credential is configured (dev convenience).
  if (cronSecret || cronKey) {
    const bearerOk =
      !!cronSecret &&
      req.headers.get("authorization") === `Bearer ${cronSecret}`;
    const cronKeyOk =
      !!cronKey && req.headers.get("x-cron-key") === cronKey;
    if (!bearerOk && !cronKeyOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const sb = getServiceSupabase();

  // Pull every opted-in user.  We need their auth.users.email which
  // isn't exposed via the profiles table — the email channel fetches it
  // via the auth admin API per user.  In practice the opt-in set is small.
  const { data: optins, error: optErr } = await sb
    .from("profiles")
    .select("id")
    .eq("email_digest_optin", true);
  if (optErr) {
    return NextResponse.json({ error: optErr.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of optins ?? []) {
    try {
      const userId = row.id as string;
      const model = await buildDigestModel(userId, { sb });
      if (!model) {
        skipped++;
        continue;
      }

      // Render + send through the email channel.  A "skipped" result
      // covers both "no recipient email" and "Resend not configured" —
      // the same soft-fail gates this route had inline before.
      const result = await emailChannel.sendDigest(userId, model);
      if (result.status === "skipped") {
        skipped++;
        continue;
      }
      if (result.status === "failed") {
        console.error("[digest] resend error", result.error);
        errors++;
        continue;
      }

      // Mark every notification in this digest as sent.  Chunk into
      // groups of 200 to keep the IN clause sane on large digests.
      const ids = model.notificationIds;
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { error: upErr } = await sb
          .from("notifications")
          .update({ email_sent_at: new Date().toISOString() })
          .in("id", chunk);
        if (upErr) {
          console.error("[digest] mark-sent failed", upErr);
        }
      }
      sent++;
    } catch (err) {
      errors++;
      console.error("[digest] user failed", row.id, err);
    }
  }

  // Telegram digest — purely additive.  The email behavior, auth, opt-in
  // query, and {sent,skipped,errors} counters above are UNCHANGED; this fans
  // the daily digest out to linked telegram users with the digest.daily/
  // telegram opt-in.  It reuses the SAME channel-neutral buildDigestModel and
  // never sends email.  Reported under a separate `telegram` key so the email
  // shape stays intact.
  let telegram: { sent: number; skipped: number; failed: number } = {
    sent: 0,
    skipped: 0,
    failed: 0,
  };
  try {
    telegram = await dispatchTelegramDigests();
  } catch (err) {
    console.error("[digest] telegram fan-out failed", err);
  }

  return NextResponse.json({ sent, skipped, errors, telegram });
}
