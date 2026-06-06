import type { DeliveryResult } from "@/lib/notifications/channels/types";

// Single shared Resend HTTP sender for NOTIFICATION email (per-event +
// daily digest).  Collapses the two previously-duplicated Resend POSTs
// (lib/notify-email.ts and app/api/notifications/digest/route.ts) into one
// code path WITHOUT changing the wire bytes:
//   - same endpoint (https://api.resend.com/emails)
//   - same headers (Bearer RESEND_API_KEY + Content-Type)
//   - same JSON body shape { from, to: [to], subject, html, text }
//
// `from` is REQUIRED here on purpose: the per-event path and the digest
// path historically used DIFFERENT from-address defaults, so the caller
// must pass the address it already computed.  This helper does not invent
// a default and does not touch lib/invite-email.ts (out of scope; keeps
// its own reminder-cap logic).
//
// RESEND_API_KEY is read here exactly as before.  When it is absent the
// helper reports a "skipped" result; callers that need the historical
// soft-fail accounting still gate on the key themselves before calling.

export async function sendResendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  from: string;
}): Promise<DeliveryResult> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { status: "skipped" };
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    return { status: "failed", error: `${r.status} ${body}` };
  }
  return { status: "sent" };
}
