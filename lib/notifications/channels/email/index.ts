import { EMAIL_KIND_LABELS, type NotificationKind } from "@/lib/notifications/email-labels";
import { renderDigestEmail } from "@/lib/notifications/email-digest";
import { getServiceSupabase } from "@/lib/supabase/service-role";
import type {
  DeliveryResult,
  DigestModel,
  NotificationChannel,
  NotificationRow,
  RenderableEvent,
} from "@/lib/notifications/channels/types";
import { sendResendEmail } from "./send-resend";

// Email NotificationChannel.  Wraps the EXISTING per-event + digest email
// behavior behind the channel interface WITHOUT changing the wire bytes:
//   - per-event render (subject/html/text) is moved VERBATIM from the old
//     inline block in lib/notify-email.ts.
//   - digest render is delegated to renderDigestEmail (moved verbatim from
//     the old buildDigestForUser).
//   - both send through the shared sendResendEmail helper.
//
// The per-(kind, channel='email') opt-in pref gate intentionally STAYS in
// the lib/notify-email.ts send loop (where it already lived); isLinked here
// reports only "does the user have a usable email address".  See unit notes.

function kindLabel(kind: string): string {
  return EMAIL_KIND_LABELS[kind as NotificationKind]?.subject ?? kind;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

// From-address policy for per-event mail, moved VERBATIM from
// lib/notify-email.ts: force the Resend sandbox sender outside production
// so dev/preview cannot accidentally email real users.
function eventFromAddr(): string {
  return process.env.NODE_ENV === "production"
    ? (process.env.RESEND_FROM ?? "Trinno <notifications@trinno.app>")
    : "Trinno <onboarding@resend.dev>";
}

// Per-event render moved VERBATIM from lib/notify-email.ts.  Given the
// resolved actor/card/board copy, builds the identical subject/html/text.
export function renderEventEmail(input: {
  actorName: string;
  cardTitle: string;
  boardTitle: string;
  kind: string;
  relatedCardId: string | null;
  relatedBoardId: string | null;
}): { subject: string; html: string; text: string } {
  const { actorName, cardTitle, boardTitle } = input;
  const verb = kindLabel(input.kind);
  const subject = `${actorName} ${verb}${cardTitle ? `: ${cardTitle}` : ""}`;
  const linkPath = input.relatedCardId
    ? `/c/${input.relatedCardId}`
    : input.relatedBoardId
      ? `/b/${input.relatedBoardId}`
      : "/inbox";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const link = `${baseUrl}${linkPath}`;
  const actorNameHtml = escapeHtml(actorName);
  const verbHtml = escapeHtml(verb);
  const cardTitleHtml = escapeHtml(cardTitle);
  const boardTitleHtml = escapeHtml(boardTitle);
  const linkHtml = escapeHtml(link);
  const html = `
        <div style="font-family: -apple-system, system-ui, sans-serif; color: #fafafa; background: #0a0a0a; padding: 24px;">
          <p style="margin: 0 0 12px 0; font-size: 14px; color: #fafafa99;">Trinno</p>
          <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>${actorNameHtml}</strong> ${verbHtml}${cardTitle ? ` <strong>${cardTitleHtml}</strong>` : ""}.</p>
          ${boardTitle ? `<p style="margin: 0 0 16px 0; font-size: 13px; color: #fafafa99;">Board · ${boardTitleHtml}</p>` : ""}
          <p style="margin: 0 0 24px 0;"><a href="${linkHtml}" style="color: #38bdf8;">Open in Trinno</a></p>
          <p style="margin: 24px 0 0 0; font-size: 12px; color: #fafafa59;">
            You're receiving this because you opted in to email for this kind in /settings/notifications.
          </p>
        </div>
      `;
  const text = `${actorName} ${verb}${cardTitle ? `: ${cardTitle}` : ""}\n${boardTitle ? `Board: ${boardTitle}\n` : ""}\n${link}`;
  return { subject, html, text };
}

// Resolve actor display name + minimal card/board copy for one event,
// moved VERBATIM from the lib/notify-email.ts send loop.
async function resolveEventCopy(
  sb: ReturnType<typeof getServiceSupabase>,
  n: NotificationRow,
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

export const emailChannel: NotificationChannel = {
  id: "email",

  // "Linked" for email = the user has a usable email address on file.
  // (The per-kind opt-in gate stays in the notify-email send loop.)
  async isLinked(userId: string): Promise<boolean> {
    const sb = getServiceSupabase();
    const { data: u } = await sb.auth.admin.getUserById(userId);
    return !!u.user?.email;
  },

  // Render + send ONE per-event email.  Returns:
  //   skipped — recipient has no email (caller must NOT stamp sent)
  //   failed  — Resend rejected the send
  //   sent    — delivered (caller stamps email_sent_at)
  async sendEvent(
    _userId: string,
    e: RenderableEvent,
  ): Promise<DeliveryResult> {
    const sb = getServiceSupabase();
    const n = e.notification;

    const { data: u } = await sb.auth.admin.getUserById(n.recipient_user_id);
    const toEmail = u.user?.email;
    if (!toEmail) {
      return { status: "skipped" };
    }

    const { actorName, cardTitle, boardTitle } = await resolveEventCopy(sb, n);
    const { subject, html, text } = renderEventEmail({
      actorName,
      cardTitle,
      boardTitle,
      kind: n.kind,
      relatedCardId: n.related_card_id,
      relatedBoardId: n.related_board_id,
    });

    return sendResendEmail({
      to: toEmail,
      subject,
      html,
      text,
      from: eventFromAddr(),
    });
  },

  // Render + send the daily digest from an assembled model.  The render is
  // the moved-verbatim renderDigestEmail; the from-address default mirrors
  // the historical digest-route default.
  async sendDigest(
    _userId: string,
    d: DigestModel,
  ): Promise<DeliveryResult> {
    const sb = getServiceSupabase();
    const { data: u } = await sb.auth.admin.getUserById(d.userId);
    const toEmail = u.user?.email;
    if (!toEmail) {
      return { status: "skipped" };
    }

    const { subject, html, text } = renderDigestEmail(d);
    const from = process.env.RESEND_FROM ?? "Trinno <notifications@trinno.local>";
    return sendResendEmail({ to: toEmail, subject, html, text, from });
  },
};
