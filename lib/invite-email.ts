import { getServiceSupabase } from "@/lib/supabase/service-role";

// Mirror lib/notify-email.ts: escape user-controlled strings before they land
// in the email HTML. Workspace names are admin-set but still untrusted input.
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
export async function sendInviteEmail(
  email: string,
  workspaceName: string,
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
  const safeName = escapeHtml(workspaceName);

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #fafafa; background: #0a0a0a; padding: 24px;">
      <p style="margin: 0 0 8px 0; font-size: 16px;">You've been invited to <strong>${safeName}</strong> on Trinno.</p>
      <p style="margin: 0 0 24px 0;"><a href="${link}" style="color: #38bdf8;">Accept the invite &amp; set your password</a></p>
    </div>`;
  const text = `You've been invited to ${workspaceName} on Trinno.\nAccept and set your password: ${link}`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromAddr, to: [email], subject: `Invitation to ${workspaceName}`, html, text }),
  });
  if (!r.ok) {
    console.error("[invite-email] resend error", r.status, await r.text());
  }
}
