import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/service-role";
import { sendMessage } from "@/lib/notifications/channels/telegram/client";

// Inbound Telegram webhook — completes the account-link handshake.
//
// Auth: Telegram echoes the secret_token we registered (see
// scripts/telegram-set-webhook.mjs) in the `x-telegram-bot-api-secret-token`
// header on every delivery. We reject anything that doesn't match. This is the
// ONLY response path that is not 200 — every other branch returns 200 so
// Telegram does not enter a retry storm replaying a poison update.
//
// Handles three inbound kinds:
//   (A) my_chat_member "kicked"/"left" — user blocked/removed the bot →
//       revoke the link instantly (no waiting for the next send to 403).
//   (B) "/stop" message — explicit unsubscribe from inside Telegram → revoke.
//   (C) "/start <token>" — completes the account-link handshake.
//
// Link flow: a user taps the t.me/<bot>?start=<token> deep-link minted by
// startTelegramLink; Telegram delivers a message whose text is
// "/start <token>". We sha256-hash the token, find the matching pending row,
// flip it to linked, and best-effort confirm in-chat.
//
// Dedupe by update_id: NOT implemented. The only mutation is idempotent in
// effect — once a pending row is consumed (hash cleared) a replayed /start
// hashes to nothing and falls through to the "expired/invalid" reply. Noted as
// a deliberate skip.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number | string };
    // The sender. `username` is the @handle (without '@') and is OPTIONAL on
    // Telegram — users without a public username omit it, so it may be
    // undefined; we persist it as null in that case.
    from?: { username?: string };
  };
  // Sent when the bot's chat-membership changes. In a private chat the user
  // blocking the bot arrives as new_chat_member.status === "kicked"; "left"
  // covers removal from a group. We use it to revoke the link instantly.
  my_chat_member?: {
    chat?: { id?: number | string };
    new_chat_member?: { status?: string };
  };
};

// Fresh response each call — a shared NextResponse singleton's body can only be
// read once (callers/tests that .json() it would hit "Body already read").
function ok(): NextResponse {
  return NextResponse.json({ ok: true });
}

// Revoke a telegram link by its chat id (external_id). Shared by the /stop
// command and the my_chat_member block handler. Idempotent: clears external_id
// so a repeat event is a no-op and a future /start re-links from a clean row.
// Returns true when a previously-linked row was actually revoked.
async function revokeByChatId(
  sb: ReturnType<typeof getServiceSupabase>,
  chatIdStr: string,
): Promise<boolean> {
  const { data } = await sb
    .from("user_channel_links")
    .update({ status: "revoked", external_id: null })
    .eq("channel", "telegram")
    .eq("external_id", chatIdStr)
    .select("user_id");
  return Array.isArray(data) && data.length > 0;
}

export async function POST(req: Request) {
  // AUTH — Telegram-echoed secret. Mismatch is the sole non-200 path.
  const provided = req.headers.get("x-telegram-bot-api-secret-token");
  if (provided !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    // Malformed body: ack so Telegram stops retrying.
    return ok();
  }

  const sb = getServiceSupabase();

  // (A) Bot blocked / removed: Telegram delivers my_chat_member with a terminal
  // status ("kicked" when a user blocks the bot, "left" when removed from a
  // group). Revoke that chat's link immediately so delivery stops without
  // waiting for the next send to 403. Any non-terminal status is ignored.
  const memberStatus = update.my_chat_member?.new_chat_member?.status;
  const memberChatId = update.my_chat_member?.chat?.id;
  if (memberStatus !== undefined) {
    if (
      (memberStatus === "kicked" ||
        memberStatus === "left" ||
        memberStatus === "banned") &&
      memberChatId !== undefined &&
      memberChatId !== null
    ) {
      await revokeByChatId(sb, String(memberChatId));
    }
    return ok();
  }

  const text = update.message?.text;
  const chatId = update.message?.chat?.id;
  // Telegram @handle of the sender (no '@'); undefined when the user has none.
  const handle = update.message?.from?.username ?? null;

  // (B) /stop: explicit unsubscribe from inside Telegram. Revoke + confirm.
  if (
    typeof text === "string" &&
    /^\/stop\b/.test(text) &&
    chatId !== undefined &&
    chatId !== null
  ) {
    const revoked = await revokeByChatId(sb, String(chatId));
    await sendMessage({
      chatId: String(chatId),
      html: revoked
        ? "🔕 <b>Unsubscribed.</b> You won't receive Trinno notifications here. Reconnect anytime from Trinno → Settings → Notifications."
        : "You're not currently connected to Trinno. Connect from Settings → Notifications.",
    }).catch(() => {});
    return ok();
  }

  // (C) /start <token> drives a link. Any other update/message is ack'd + ignored.
  const match = typeof text === "string" ? text.match(/^\/start\s+(\S+)/) : null;
  if (!match || chatId === undefined || chatId === null) {
    return ok();
  }

  const token = match[1];
  const hash = sha256hex(token);
  const chatIdStr = String(chatId);

  // Find the single pending, non-expired link row this token unlocks.
  const nowIso = new Date().toISOString();
  const { data: row } = await sb
    .from("user_channel_links")
    .select("user_id")
    .eq("link_token_hash", hash)
    .eq("status", "pending")
    .gt("link_token_exp", nowIso)
    .maybeSingle();

  if (!row) {
    // Expired or invalid token. Best-effort nudge; never fail the webhook.
    await sendMessage({
      chatId: chatIdStr,
      html: "This link expired or is invalid. Open Trinno → Settings → Notifications and generate a new one.",
    }).catch(() => {});
    return ok();
  }

  // Complete the link. Re-scope the update by user_id + token hash so a
  // concurrent webhook can't flip a different row; clears the token so a
  // replayed /start can't re-consume it.
  const { error } = await sb
    .from("user_channel_links")
    .update({
      external_id: chatIdStr,
      // Persist the sender's @handle (null when the user has no username) for
      // display in settings ("@handle · Connected").
      handle,
      status: "linked",
      linked_at: new Date().toISOString(),
      link_token_hash: null,
      link_token_exp: null,
    })
    .eq("user_id", row.user_id)
    .eq("channel", "telegram")
    .eq("link_token_hash", hash);

  if (error) {
    // The likely cause is the unique(channel, external_id) constraint: this
    // chat is already linked to a DIFFERENT Trinno user. Tell them, ack.
    await sendMessage({
      chatId: chatIdStr,
      html: "This Telegram account is already linked to another Trinno user.",
    }).catch(() => {});
    return ok();
  }

  // Best-effort confirmation. The link already succeeded; a send failure
  // (fake chat, blocked bot, missing token) must not fail the webhook.
  await sendMessage({
    chatId: chatIdStr,
    html: "✅ <b>Connected to Trinno.</b> You'll receive your activity + daily digest here.",
  }).catch(() => {});

  return ok();
}
