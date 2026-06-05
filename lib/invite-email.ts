import { getServiceSupabase } from "@/lib/supabase/service-role";

// Mirror lib/notify-email.ts: escape user-controlled strings before they land
// in the email HTML. Workspace names are admin-set but still untrusted input;
// the inviter's display name is user-set and therefore also untrusted.
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

// Re-issues a Supabase auth link for an already-created (unconfirmed) invitee
// and delivers it via Resend (same channel as notify-email). Soft-fails in dev
// when RESEND_API_KEY is unset — the link is still generated; only delivery is
// skipped. NOTE: link type chosen to work for an EXISTING unconfirmed user
// (see comment at the generateLink call).
//
// `inviterName` is optional: when present the subject/headline name the person
// who invited you ("Alice invited you to …"); when absent it falls back to an
// impersonal wording so older callers keep working.
export async function sendInviteEmail(
  email: string,
  workspaceName: string,
  inviterName?: string,
): Promise<void> {
  const sb = getServiceSupabase();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/accept-invite`;

  // "invite" is the first type verified to produce a valid action_link for an
  // existing unconfirmed user against local Supabase. Tested with all three
  // types (invite, magiclink, recovery) — all returned an action_link without
  // error; "invite" is preferred per the implementation plan.
  const { data, error } = await sb.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });
  if (error || !data?.properties?.action_link) {
    throw new Error(error?.message ?? "Could not generate invite link");
  }
  const link = data.properties.action_link;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return; // dev soft-fail: link generated, delivery skipped
  // Force the Resend sandbox sender outside production. Without a verified domain,
  // Resend only delivers to the account owner — so dev/preview cannot accidentally
  // email real users even if RESEND_API_KEY is the prod key.
  const fromAddr =
    process.env.NODE_ENV === "production"
      ? (process.env.RESEND_FROM ?? "Trinno <notifications@trinno.app>")
      : "Trinno <onboarding@resend.dev>";

  const trimmedInviter = inviterName?.trim() || undefined;
  const safeName = escapeHtml(workspaceName);
  const safeInviter = trimmedInviter ? escapeHtml(trimmedInviter) : undefined;

  // Subjects/headlines name the inviter when we know it, else stay impersonal.
  const subject = trimmedInviter
    ? `${trimmedInviter} invited you to ${workspaceName} on Trinno`
    : `You've been invited to ${workspaceName} on Trinno`;
  const inviterLine = safeInviter
    ? `${safeInviter} invited you to join <strong>${safeName}</strong>.`
    : `You've been invited to join <strong>${safeName}</strong>.`;

  // Email-client-safe: table layout + inline styles, brand dark theme, single
  // primary CTA, a short feature strip so the recipient knows what Trinno is,
  // and a paste-able fallback link in the footer.
  const html = `
    <div style="margin:0;padding:0;background:#0a0a0a;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0a0a0a;font-size:1px;line-height:1px;">
        Boards, roadmaps, and sprints &mdash; your team is already working in ${safeName}.
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
        <tr><td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#111111;border:1px solid #1f1f1f;border-radius:14px;">
            <tr><td style="padding:28px 32px 0 32px;">
              <span style="font-family:-apple-system,system-ui,sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#fafafa;">Trinno</span>
            </td></tr>
            <tr><td style="padding:20px 32px 0 32px;font-family:-apple-system,system-ui,sans-serif;">
              <p style="margin:0;font-size:20px;line-height:1.35;font-weight:600;color:#fafafa;">${inviterLine}</p>
              <p style="margin:8px 0 0 0;font-size:14px;line-height:1.6;color:#a1a1aa;">${safeName} runs on Trinno &mdash; one place to plan, track, and ship work together.</p>
            </td></tr>
            <tr><td style="padding:24px 32px 4px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr><td style="background:#38bdf8;border-radius:8px;">
                  <a href="${link}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,system-ui,sans-serif;font-size:15px;font-weight:600;color:#0a0a0a;text-decoration:none;">Accept invitation &amp; set password</a>
                </td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:20px 32px 4px 32px;font-family:-apple-system,system-ui,sans-serif;">
              <p style="margin:0 0 12px 0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">What you'll get</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.55;color:#d4d4d8;">
                <tr><td style="padding:5px 0;"><span style="color:#38bdf8;">&rsaquo;</span> <strong style="color:#fafafa;">Boards &amp; kanban</strong> &mdash; drag-drop cards across lists in real time</td></tr>
                <tr><td style="padding:5px 0;"><span style="color:#38bdf8;">&rsaquo;</span> <strong style="color:#fafafa;">Roadmap &amp; milestones</strong> &mdash; timeline view of every workstream</td></tr>
                <tr><td style="padding:5px 0;"><span style="color:#38bdf8;">&rsaquo;</span> <strong style="color:#fafafa;">Sprints &amp; dashboards</strong> &mdash; plan cycles, track progress at a glance</td></tr>
                <tr><td style="padding:5px 0;"><span style="color:#38bdf8;">&rsaquo;</span> <strong style="color:#fafafa;">Live collaboration</strong> &mdash; comments, due dates, presence, activity log</td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:24px 32px 28px 32px;font-family:-apple-system,system-ui,sans-serif;border-top:1px solid #1f1f1f;">
              <p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:#71717a;">Button not working? Paste this link into your browser:<br><a href="${link}" style="color:#52a8c9;word-break:break-all;">${link}</a></p>
              <p style="margin:12px 0 0 0;font-size:12px;line-height:1.6;color:#52525b;">If you weren't expecting this invitation, you can safely ignore this email.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </div>`;

  const greeting = trimmedInviter
    ? `${trimmedInviter} invited you to join ${workspaceName} on Trinno.`
    : `You've been invited to join ${workspaceName} on Trinno.`;
  const text = `${greeting}

Trinno is where your team plans, tracks, and ships work together:
  - Boards & kanban with real-time drag-drop
  - Roadmap & milestones timeline
  - Sprints & shareable dashboards
  - Comments, due dates, presence, activity log

Accept your invitation & set your password:
${link}

If you weren't expecting this, you can safely ignore this email.`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromAddr, to: [email], subject, html, text }),
  });
  if (!r.ok) {
    console.error("[invite-email] resend error", r.status, await r.text());
  }
}
