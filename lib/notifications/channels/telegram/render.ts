import { EMAIL_KIND_LABELS, type NotificationKind } from "@/lib/notifications/email-labels";
import type {
  DigestModel,
  NotificationRow,
} from "@/lib/notifications/channels/types";

// PURE Telegram renderers (no IO) for the telegram NotificationChannel.
//
// Output targets Telegram's parse_mode="HTML": only a small tag subset is
// allowed (<b>, <i>, <a href>, <code>, ...) and ALL dynamic content must be
// HTML-escaped (&, <, >) — Telegram rejects messages with stray unescaped
// entities. The deep-link base URL is the SAME source the email path uses
// (NEXT_PUBLIC_APP_URL); see lib/notify-email.ts / lib/notifications/email-digest.ts.
//
// Deep-link buttons use an inline keyboard (reply_markup.inline_keyboard) with
// a `url`. Telegram requires inline URL buttons to be absolute http(s) URLs;
// when NEXT_PUBLIC_APP_URL is unset we omit the button rather than emit a
// relative URL Telegram would reject.

// Telegram hard limit on a single text message. We keep digests under this.
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

type InlineKeyboardButton = { text: string; url: string };
type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

// Escape the three characters Telegram's HTML parser treats specially. (Quote
// chars need no escaping in text content for Telegram HTML.)
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "";
}

function kindVerb(kind: string): string {
  return EMAIL_KIND_LABELS[kind as NotificationKind]?.subject ?? kind;
}

// Build the absolute deep-link for an event. Mirrors the email path's path
// scheme: card -> /c/:id, board -> /b/:id, fallback -> /inbox.
function eventLink(n: NotificationRow): string | null {
  const base = baseUrl();
  if (!base) return null;
  if (n.related_card_id) return `${base}/c/${n.related_card_id}`;
  if (n.related_board_id) return `${base}/b/${n.related_board_id}`;
  return `${base}/inbox`;
}

function openButton(label: string, url: string | null): InlineKeyboardMarkup | undefined {
  if (!url) return undefined;
  return { inline_keyboard: [[{ text: label, url }]] };
}

// Render ONE per-event notification to Telegram HTML + an "Open card" inline
// button deep-linking to the related card/board. Actor display name is read
// from payload.actor_name when present (the send loop resolves it), else a
// neutral fallback; card/board context likewise comes from payload labels.
export function renderEvent(notification: NotificationRow): {
  html: string;
  replyMarkup?: unknown;
} {
  const p = notification.payload ?? {};
  const actorName =
    typeof p.actor_name === "string" && p.actor_name ? p.actor_name : "Someone";
  const cardTitle =
    typeof p.card_title === "string" ? p.card_title : "";
  const boardTitle =
    typeof p.board_title === "string" ? p.board_title : "";

  const verb = kindVerb(notification.kind);

  const actorHtml = escapeHtml(actorName);
  const verbHtml = escapeHtml(verb);
  const cardHtml = cardTitle ? escapeHtml(cardTitle) : "";
  const boardHtml = boardTitle ? escapeHtml(boardTitle) : "";

  const lines: string[] = [];
  lines.push(
    `<b>${actorHtml}</b> ${verbHtml}${cardHtml ? ` <b>${cardHtml}</b>` : ""}.`,
  );
  if (boardHtml) lines.push(`Board · ${boardHtml}`);
  const html = lines.join("\n");

  const url = eventLink(notification);
  const buttonLabel = notification.related_card_id ? "Open card" : "Open in Trinno";
  return { html, replyMarkup: openButton(buttonLabel, url) };
}

// Render the daily digest to a single Telegram message, ENFORCING the 4096
// char limit. We append section items until adding another would overflow,
// then emit a "+N more in app" line linking to /inbox. The inbox inline button
// is always present (when a base URL exists) so the user can reach the rest.
export function renderDigest(digest: DigestModel): {
  html: string;
  replyMarkup?: unknown;
} {
  const base = digest.baseUrl || baseUrl();
  const inboxUrl = base ? `${base}/inbox` : null;

  const headerLine =
    digest.total === 1
      ? `<b>1 update in Trinno today</b> · ${escapeHtml(digest.dateStr)}`
      : `<b>${digest.total} updates in Trinno today</b> · ${escapeHtml(digest.dateStr)}`;

  // Flatten sections into renderable lines (heading line + item lines). Each
  // item is an <a> link so the user can jump straight to the card/board.
  type Line = { text: string; itemCount: number };
  const blocks: Line[][] = [];
  for (const section of digest.sections) {
    const block: Line[] = [];
    block.push({ text: `<b>${escapeHtml(section.heading)}</b>`, itemCount: 0 });
    for (const item of section.items) {
      const label = escapeHtml(item.label);
      const href = escapeHtml(item.href);
      block.push({ text: `• <a href="${href}">${label}</a>`, itemCount: 1 });
    }
    blocks.push(block);
  }

  // Greedily accumulate whole + partial blocks while the running message stays
  // within budget. Reserve room for the worst-case "+N more" footer so adding
  // it after truncation can never push us over the limit.
  const totalItems = digest.sections.reduce((acc, s) => acc + s.items.length, 0);
  const footerFor = (remaining: number): string =>
    inboxUrl
      ? `\n\n<a href="${escapeHtml(inboxUrl)}">+${remaining} more in app</a>`
      : `\n\n+${remaining} more in app`;
  // Footer length is bounded by the all-remaining case; use total as the
  // upper bound so the reserved budget is safe for any truncation point.
  const footerReserve = footerFor(totalItems).length;

  let body = headerLine;
  let includedItems = 0;
  let truncated = false;

  outer: for (const block of blocks) {
    // A block leads with its heading; only count the heading toward output if
    // we manage to include at least its heading. We add lines one at a time so
    // a section can be partially included.
    for (const line of block) {
      const candidate = `${body}\n${line.text}`;
      // Budget = hard limit minus space reserved for a possible footer.
      const budget = TELEGRAM_MAX_MESSAGE_CHARS - footerReserve;
      if (candidate.length > budget) {
        truncated = true;
        break outer;
      }
      body = candidate;
      includedItems += line.itemCount;
    }
  }

  if (truncated || includedItems < totalItems) {
    const remaining = totalItems - includedItems;
    if (remaining > 0) {
      body += footerFor(remaining);
    }
    truncated = true;
  }

  // Defensive clamp: should never trigger given the reserved budget, but
  // guarantees the contract (length <= 4096) no matter what.
  if (body.length > TELEGRAM_MAX_MESSAGE_CHARS) {
    body = body.slice(0, TELEGRAM_MAX_MESSAGE_CHARS);
  }

  const replyMarkup = inboxUrl
    ? { inline_keyboard: [[{ text: "Open inbox", url: inboxUrl }]] }
    : undefined;
  return { html: body, replyMarkup };
}
