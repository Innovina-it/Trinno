import { createClient } from "@supabase/supabase-js";

// Email pipeline.  Fetches notifications with email_sent_at IS NULL,
// gates each by user_notification_prefs(channel='email', enabled=true),
// resolves recipient email + actor display name + card/board copy, and
// dispatches via the Resend HTTP API.  Marks email_sent_at on success.
//
// Default policy: email is OPT-IN — a user must flip the toggle in
// /settings/notifications (kind, channel='email') for any kind they
// want to receive by email.  In-app stays the default channel.
//
// All work is done with the service-role client because the worker
// needs to look up auth.users.email + write email_sent_at across
// users.  Never expose this code to the browser.

type Notif = {
  id: string;
  recipient_user_id: string;
  kind: string;
  related_card_id: string | null;
  related_board_id: string | null;
  actor_user_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const VERB_BY_KIND: Record<string, string> = {
  "comment.mention": "mentioned you in a comment",
  "comment.create": "commented on a card you watch",
  "card.assigned": "assigned you to a card",
  "card.unassigned": "unassigned you from a card",
  "card.due": "set a due date on a card you watch",
  "card.dates": "rescheduled a card you watch",
  "card.archived": "archived a card you watch",
  "card.unarchived": "restored a card you watch",
  "card.moved": "moved a card you watch",
  "card.linked": "linked a card to one you watch",
  "card.sprint_changed": "moved a card you watch to a different sprint",
  "board.member.added": "added you to a board",
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

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
  const fromAddr = process.env.RESEND_FROM ?? "Trinno <notifications@trinno.local>";

  const sb = admin();

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

      // Resolve recipient email via auth admin API.
      const { data: u } = await sb.auth.admin.getUserById(n.recipient_user_id);
      const toEmail = u.user?.email;
      if (!toEmail) {
        skipped++;
        continue;
      }

      // Resolve actor name + minimal card/board copy.
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

      const verb = VERB_BY_KIND[n.kind] ?? n.kind;
      const subject = `${actorName} ${verb}${cardTitle ? `: ${cardTitle}` : ""}`;
      const linkPath = n.related_card_id
        ? `/c/${n.related_card_id}`
        : n.related_board_id
          ? `/b/${n.related_board_id}`
          : "/inbox";
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const link = `${baseUrl}${linkPath}`;
      const html = `
        <div style="font-family: -apple-system, system-ui, sans-serif; color: #fafafa; background: #0a0a0a; padding: 24px;">
          <p style="margin: 0 0 12px 0; font-size: 14px; color: #fafafa99;">Trinno</p>
          <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>${actorName}</strong> ${verb}${cardTitle ? ` <strong>${cardTitle}</strong>` : ""}.</p>
          ${boardTitle ? `<p style="margin: 0 0 16px 0; font-size: 13px; color: #fafafa99;">Board · ${boardTitle}</p>` : ""}
          <p style="margin: 0 0 24px 0;"><a href="${link}" style="color: #38bdf8;">Open in Trinno</a></p>
          <p style="margin: 24px 0 0 0; font-size: 12px; color: #fafafa59;">
            You're receiving this because you opted in to email for this kind in /settings/notifications.
          </p>
        </div>
      `;
      const text = `${actorName} ${verb}${cardTitle ? `: ${cardTitle}` : ""}\n${boardTitle ? `Board: ${boardTitle}\n` : ""}\n${link}`;

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [toEmail],
          subject,
          html,
          text,
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        console.error("[notify-email] resend error", r.status, body);
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
