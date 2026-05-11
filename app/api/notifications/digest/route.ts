import { NextResponse } from "next/server";
import { admin, buildDigestForUser } from "@/lib/notifications/email-digest";

// Daily digest cron handler.  Loops every user with email_digest_optin =
// true, builds a digest from the last 24h of unsent notifications, sends
// via Resend, then stamps email_sent_at on the included rows so the
// per-event sender doesn't double-send them.
//
// Auth: header `x-cron-key` must match process.env.CRON_KEY.  In dev,
// CRON_KEY may be unset — in that case auth is skipped so a developer
// can curl the route locally.
//
// Schedule: target 09:00 UTC.  For Vercel, add to `vercel.json`:
//   { "path": "/api/notifications/digest", "schedule": "0 9 * * *" }
// For self-hosted, run an external cron that POSTs with the header.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cronKey = process.env.CRON_KEY;
  if (cronKey) {
    const provided = req.headers.get("x-cron-key");
    if (provided !== cronKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromAddr =
    process.env.RESEND_FROM ?? "Trinno <notifications@trinno.local>";

  const sb = admin();

  // Pull every opted-in user.  We need their auth.users.email which
  // isn't exposed via the profiles table — fetch it via the auth
  // admin API per user.  In practice the opt-in set is small.
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
      const digest = await buildDigestForUser(userId, { sb });
      if (!digest) {
        skipped++;
        continue;
      }

      // Resolve email via auth admin.
      const { data: u } = await sb.auth.admin.getUserById(userId);
      const toEmail = u.user?.email;
      if (!toEmail) {
        skipped++;
        continue;
      }

      // Soft-fail in dev when Resend is not configured: still mark the
      // notifications as sent so we don't pile them up forever, but
      // count as skipped (nothing actually delivered).
      if (!resendKey) {
        skipped++;
        continue;
      }

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [toEmail],
          subject: digest.subject,
          html: digest.html,
          text: digest.text,
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        console.error("[digest] resend error", r.status, body);
        errors++;
        continue;
      }

      // Mark every notification in this digest as sent.  Chunk into
      // groups of 200 to keep the IN clause sane on large digests.
      const ids = digest.notificationIds;
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

  return NextResponse.json({ sent, skipped, errors });
}
