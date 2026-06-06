import type { DeliveryResult } from "@/lib/notifications/channels/types";

// Telegram Bot API send client for the telegram NotificationChannel.
//
// Scope (this unit): PURE send only — no account linking, no webhook, no
// token minting, no setWebhook, no ledger writes. Those belong to a later
// unit.
//
// Env: TELEGRAM_BOT_TOKEN is read LAZILY inside sendMessage (never at module
// top-level) so importing this module with no token configured does NOT throw
// — type-check/build pass with no bot token set. If the token is missing at
// call time we return a DeliveryResult failure rather than throwing.

const TELEGRAM_API_BASE = "https://api.telegram.org";

// Send-result discriminant. Extends the channel-neutral DeliveryResult with a
// `blocked` flag set ONLY when Telegram reports the bot was blocked/kicked by
// the user (HTTP 403). A later unit consumes `blocked: true` to revoke the
// user's link; until then it is informational. `status` stays "failed" so the
// generic send loop accounting treats a block as a non-delivery.
export type TelegramSendResult = DeliveryResult & { blocked?: boolean };

// Throttle to respect Telegram's documented limits: ~1 message/second per
// chat and ~30 messages/second globally. We enforce a simple GLOBAL minimum
// gap between sends (sequential) which is the binding constraint for a single
// worker dispatching one chat at a time. Self-contained: a chained promise
// serializes callers and a recorded last-send timestamp paces them.
const GLOBAL_MIN_GAP_MS = 1000 / 30; // ~33ms => <= 30 msg/sec global ceiling
const PER_CHAT_MIN_GAP_MS = 1000; // ~1 msg/sec per chat ceiling

let sendChain: Promise<void> = Promise.resolve();
let lastGlobalSendAt = 0;
const lastChatSendAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pace one send for `chatId`: serialize behind any in-flight send, then wait
// out whichever gap (global or per-chat) is longer before returning.
async function throttle(chatId: string): Promise<void> {
  const prior = sendChain;
  let release: () => void = () => {};
  sendChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prior;
    const now = Date.now();
    const sinceGlobal = now - lastGlobalSendAt;
    const sinceChat = now - (lastChatSendAt.get(chatId) ?? 0);
    const wait = Math.max(
      GLOBAL_MIN_GAP_MS - sinceGlobal,
      PER_CHAT_MIN_GAP_MS - sinceChat,
      0,
    );
    if (wait > 0) await sleep(wait);
    const sentAt = Date.now();
    lastGlobalSendAt = sentAt;
    lastChatSendAt.set(chatId, sentAt);
  } finally {
    release();
  }
}

export type SendMessageInput = {
  chatId: string;
  html: string;
  replyMarkup?: unknown;
  disableWebPagePreview?: boolean;
};

// Build the sendMessage request body. Extracted as a PURE helper so tests can
// assert chat_id / text / parse_mode without performing any network IO.
export function buildSendMessageBody(input: SendMessageInput): {
  chat_id: string;
  text: string;
  parse_mode: "HTML";
  disable_web_page_preview: boolean;
  reply_markup?: unknown;
} {
  const body: {
    chat_id: string;
    text: string;
    parse_mode: "HTML";
    disable_web_page_preview: boolean;
    reply_markup?: unknown;
  } = {
    chat_id: input.chatId,
    text: input.html,
    parse_mode: "HTML",
    disable_web_page_preview: input.disableWebPagePreview ?? true,
  };
  if (input.replyMarkup !== undefined) body.reply_markup = input.replyMarkup;
  return body;
}

// POST a message to the Telegram Bot API. Returns a TelegramSendResult:
//   - { status: "failed", error: "TELEGRAM_BOT_TOKEN not configured" }
//       token missing at call time (does NOT throw)
//   - { status: "failed", error: "blocked", blocked: true }
//       HTTP 403 — bot blocked/kicked by the user (a later unit revokes link)
//   - { status: "failed", error: "<status> <body>" }
//       any other non-2xx response
//   - { status: "sent" }
//       delivered
export async function sendMessage(
  input: SendMessageInput,
): Promise<TelegramSendResult> {
  // Lazy read — importing this module must never require the env var.
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { status: "failed", error: "TELEGRAM_BOT_TOKEN not configured" };
  }

  await throttle(input.chatId);

  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSendMessageBody(input)),
    });
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (r.status === 403) {
    // Bot blocked or kicked by the user. Distinct signal so a later unit can
    // revoke the link; keep status "failed" for generic accounting.
    return { status: "failed", error: "blocked", blocked: true };
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { status: "failed", error: `${r.status} ${body}`.trim() };
  }
  return { status: "sent" };
}
