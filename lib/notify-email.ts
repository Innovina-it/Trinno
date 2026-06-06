import { emailChannel } from "@/lib/notifications/channels/email";
import type { NotificationRow } from "@/lib/notifications/channels/types";
import { getServiceSupabase } from "@/lib/supabase/service-role";

// Email pipeline.  Fetches notifications with email_sent_at IS NULL,
// gates each by user_notification_prefs(channel='email', enabled=true),
// then hands the row to the email channel which resolves recipient +
// actor/card/board copy, renders, and dispatches via the Resend HTTP API.
// Marks email_sent_at on success.
//
// Default policy: email is OPT-IN — a user must flip the toggle in
// /settings/notifications (kind, channel='email') for any kind they
// want to receive by email.  In-app stays the default channel.
//
// All work is done with the service-role client because the worker
// needs to look up auth.users.email + write email_sent_at across
// users.  Never expose this code to the browser.
//
// U2: the per-event render + Resend send moved into the email channel
// (lib/notifications/channels/email).  The opt-in pref gate stays here.
// Email output is byte-identical to before.

type Notif = NotificationRow;

export async function processPendingEmails(opts: {
  limit?: number;
  olderThanMinutes?: number;
} = {}): Promise<{ sent: number; skipped: number; errors: number }> {
  const limit = opts.limit ?? 100;
  const minAgeMin = opts.olderThanMinutes ?? 0;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    // Soft-fail in dev: report nothing to do.  Production deployments
    // that intend to send email must set the key.
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const sb = getServiceSupabase();

  // Pull pending notifications (oldest first).
  const cutoffIso = new Date(Date.now() - minAgeMin * 60_000).toISOString();
  const { data: rows, error } = await sb
    .from("notifications")
    .select(
      "id, recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload, created_at",
    )
    .is("email_sent_at", null)
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const pending = (rows ?? []) as Notif[];

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const n of pending) {
    try {
      // Opt-in check.  If no row OR enabled=false, skip.
      const { data: pref } = await sb
        .from("user_notification_prefs")
        .select("enabled")
        .eq("user_id", n.recipient_user_id)
        .eq("kind", n.kind)
        .eq("channel", "email")
        .maybeSingle();
      if (!pref || !pref.enabled) {
        skipped++;
        await sb
          .from("notifications")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", n.id);
        continue;
      }

      // Resolve recipient + render + send via the email channel.
      const result = await emailChannel.sendEvent(n.recipient_user_id, {
        notification: n,
      });
      if (result.status === "skipped") {
        // No usable recipient email — do not stamp, matching prior behavior.
        skipped++;
        continue;
      }
      if (result.status === "failed") {
        console.error("[notify-email] resend error", result.error);
        errors++;
        continue;
      }
      sent++;
      await sb
        .from("notifications")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", n.id);
    } catch (err) {
      errors++;
      console.error("[notify-email] row failed", n.id, err);
    }
  }
  return { sent, skipped, errors };
}
