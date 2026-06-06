import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_KIND_LABELS,
  type NotificationKind,
} from "@/lib/notifications/email-labels";
import type {
  DigestModel,
  NotificationRow,
} from "@/lib/notifications/channels/types";
import { getServiceSupabase } from "@/lib/supabase/service-role";

// Daily digest builder.  Companion to lib/notify-email.ts (per-event sender)
// — this assembles ONE email per user per day grouped by kind/card from the
// last 24h of unsent notifications.
//
// Usage: invoked by /api/notifications/digest (cron) once per day.  Returns
// `null` when the user has nothing pending so the route can record a skip
// without sending an empty email.
//
// Split (U2): buildDigestModel() does the channel-neutral data assembly
// (grouping + label/link resolution) and returns a DigestModel.  The HTML/
// subject/text rendering lives in renderDigestEmail() and is also driven by
// the email channel (lib/notifications/channels/email).  buildDigestForUser()
// remains a thin wrapper (assemble -> render) so existing callers and parity
// checks keep working with byte-identical output.

type Notif = NotificationRow;

function labelFor(kind: string, count: number): string {
  const entry = EMAIL_KIND_LABELS[kind as NotificationKind];
  if (!entry) return `${count} ${kind}`;
  return `${count} ${count === 1 ? entry.subject : entry.preview}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type DigestResult = {
  subject: string;
  html: string;
  text: string;
  notificationIds: string[];
};

// Channel-neutral assembly: groups the user's last-24h unsent notifications
// by kind, then by card/board, resolving display labels + links in bulk.
// Returns the structured data only (no HTML).  `null` when nothing pending.
export async function buildDigestModel(
  userId: string,
  opts: { now?: Date; sb?: SupabaseClient } = {},
): Promise<DigestModel | null> {
  const sb = opts.sb ?? getServiceSupabase();
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();

  // Pull every unsent notification for this user in the last 24h.  We
  // OR-filter on email_sent_at IS NULL so a user re-opting-in mid-day
  // doesn't double-send anything that already went out via per-event.
  const { data: rows, error } = await sb
    .from("notifications")
    .select(
      "id, recipient_user_id, kind, related_card_id, related_board_id, actor_user_id, payload, created_at",
    )
    .eq("recipient_user_id", userId)
    .is("email_sent_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const items = (rows ?? []) as Notif[];
  if (items.length === 0) return null;

  // Group by kind, then by card_id within each kind.  Cards without an
  // id (e.g. board.member.added) collapse under a `null` bucket.
  const byKind = new Map<string, Notif[]>();
  for (const n of items) {
    const list = byKind.get(n.kind) ?? [];
    list.push(n);
    byKind.set(n.kind, list);
  }

  // Resolve card/board titles in bulk to avoid N+1 lookups.
  const cardIds = Array.from(
    new Set(items.map((n) => n.related_card_id).filter((x): x is string => !!x)),
  );
  const boardIds = Array.from(
    new Set(items.map((n) => n.related_board_id).filter((x): x is string => !!x)),
  );
  const titles = new Map<string, string>();
  const boardTitles = new Map<string, string>();
  if (cardIds.length > 0) {
    const { data: cards } = await sb
      .from("cards")
      .select("id, title")
      .in("id", cardIds);
    for (const c of cards ?? []) titles.set(c.id, c.title);
  }
  if (boardIds.length > 0) {
    const { data: boards } = await sb
      .from("boards")
      .select("id, title")
      .in("id", boardIds);
    for (const b of boards ?? []) boardTitles.set(b.id, b.title);
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const dateStr = now.toISOString().slice(0, 10);

  // Build sections.  One section per kind; each lists the affected cards
  // (or board names for memberships).  Labels/hrefs are stored RAW here —
  // HTML escaping happens at render time so the wire bytes are unchanged.
  const sections: DigestModel["sections"] = [];
  for (const [kind, group] of byKind) {
    const heading = labelFor(kind, group.length);

    // Sub-group by card so "5 new comments" lists 2 cards not 5 lines.
    const byCard = new Map<string, Notif[]>();
    for (const n of group) {
      const key = n.related_card_id ?? `__board:${n.related_board_id ?? "_"}`;
      const list = byCard.get(key) ?? [];
      list.push(n);
      byCard.set(key, list);
    }

    const sectionItems: DigestModel["sections"][number]["items"] = [];
    for (const [key, ns] of byCard) {
      const first = ns[0];
      let label: string;
      let href: string;
      if (first.related_card_id) {
        const t = titles.get(first.related_card_id) ?? "Untitled card";
        label = ns.length > 1 ? `${t} (${ns.length})` : t;
        href = `${baseUrl}/c/${first.related_card_id}`;
      } else if (first.related_board_id) {
        const t = boardTitles.get(first.related_board_id) ?? "Board";
        label = ns.length > 1 ? `${t} (${ns.length})` : t;
        href = `${baseUrl}/b/${first.related_board_id}`;
      } else {
        label = `${ns.length} update${ns.length === 1 ? "" : "s"}`;
        href = `${baseUrl}/inbox`;
      }
      void key;
      sectionItems.push({ label, href });
    }

    sections.push({ heading, items: sectionItems });
  }

  return {
    userId,
    dateStr,
    total: items.length,
    sections,
    baseUrl,
    notificationIds: items.map((n) => n.id),
  };
}

// Render the digest wire format (subject/html/text) from an assembled
// DigestModel.  This is the digest render path moved VERBATIM out of the
// old buildDigestForUser — same templates, same escaping, same joins — so
// output is byte-identical.  Shared by buildDigestForUser and emailChannel.
export function renderDigestEmail(model: DigestModel): {
  subject: string;
  html: string;
  text: string;
} {
  const { baseUrl, dateStr, total } = model;

  const sectionsHtml: string[] = [];
  const sectionsText: string[] = [];
  for (const section of model.sections) {
    const heading = section.heading;

    const liHtml: string[] = [];
    const liText: string[] = [];
    for (const item of section.items) {
      const { label, href } = item;
      liHtml.push(
        `<li style="margin: 4px 0;"><a href="${escapeHtml(href)}" style="color: #38bdf8; text-decoration: none;">${escapeHtml(label)}</a></li>`,
      );
      liText.push(`- ${label}  ${href}`);
    }

    sectionsHtml.push(`
      <tr>
        <td style="padding: 16px 0 8px 0; border-top: 1px solid #1f1f1f;">
          <p style="margin: 0 0 8px 0; font-size: 14px; color: #fafafa; font-weight: 600;">${escapeHtml(heading)}</p>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #fafafa;">
            ${liHtml.join("\n")}
          </ul>
        </td>
      </tr>
    `);
    sectionsText.push(`${heading}\n${liText.join("\n")}\n`);
  }

  const subject =
    total === 1
      ? `1 update in Trinno today · ${dateStr}`
      : `${total} updates in Trinno today · ${dateStr}`;

  const html = `
<div style="font-family: -apple-system, system-ui, sans-serif; color: #fafafa; background: #0a0a0a; padding: 24px;">
  <p style="margin: 0 0 4px 0; font-size: 12px; color: #fafafa99; letter-spacing: 0.08em;">TRINNO · DAILY DIGEST</p>
  <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #fafafa;">${escapeHtml(subject)}</h1>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
    ${sectionsHtml.join("")}
  </table>
  <p style="margin: 24px 0 8px 0;"><a href="${escapeHtml(baseUrl)}/inbox" style="color: #38bdf8;">Open inbox</a></p>
  <p style="margin: 0; font-size: 12px; color: #fafafa59;">
    You're receiving this because you opted in to the daily digest in /settings/notifications.
  </p>
</div>
  `.trim();

  const text =
    `${subject}\n\n` + sectionsText.join("\n") + `\n${baseUrl}/inbox\n`;

  return { subject, html, text };
}

// Thin wrapper: assemble -> render.  Kept for parity and any callers that
// still want the fully-rendered digest in one call.
export async function buildDigestForUser(
  userId: string,
  opts: { now?: Date; sb?: SupabaseClient } = {},
): Promise<DigestResult | null> {
  const model = await buildDigestModel(userId, opts);
  if (!model) return null;
  const { subject, html, text } = renderDigestEmail(model);
  return {
    subject,
    html,
    text,
    notificationIds: model.notificationIds,
  };
}
