import { getServiceSupabase } from "@/lib/supabase/service-role";
import type {
  DeliveryResult,
  DigestModel,
  NotificationChannel,
  RenderableEvent,
} from "@/lib/notifications/channels/types";
import { sendMessage } from "./client";
import { renderDigest, renderEvent } from "./render";

// Telegram NotificationChannel — PURE send + render.
//
// Scope (this unit): isLinked / sendEvent / sendDigest against the existing
// channel interface, backed by render.ts (pure) + client.ts (Bot API POST).
// EXPLICITLY out of scope (a later unit owns these): account linking, the
// inbound webhook, link-token minting, setWebhook, cron wiring, and any writes
// to notification_deliveries. This module performs NO ledger writes.
//
// Identity lives in user_channel_links (migration 0124): a row keyed by
// (user_id, channel) holds the Telegram chat id in external_id once
// status='linked'. We read it with the service-role client (no user session).

// Resolve the linked Telegram chat id for a user, or null if not linked.
// "Linked" = a user_channel_links row with channel='telegram',
// status='linked', and a non-null external_id (the chat id).
async function resolveChatId(userId: string): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("user_channel_links")
    .select("external_id")
    .eq("user_id", userId)
    .eq("channel", "telegram")
    .eq("status", "linked")
    .maybeSingle();
  const chatId = data?.external_id;
  return typeof chatId === "string" && chatId ? chatId : null;
}

export const telegramChannel: NotificationChannel = {
  id: "telegram",

  // "Linked" for telegram = the user has a linked chat id on file.
  async isLinked(userId: string): Promise<boolean> {
    return (await resolveChatId(userId)) !== null;
  },

  // Render + send ONE per-event Telegram message. Returns:
  //   skipped — user has no linked Telegram (caller must NOT stamp sent)
  //   failed  — Bot API rejected the send (incl. blocked / missing token)
  //   sent    — delivered
  async sendEvent(
    userId: string,
    e: RenderableEvent,
  ): Promise<DeliveryResult> {
    const chatId = await resolveChatId(userId);
    if (!chatId) return { status: "skipped" };

    const { html, replyMarkup } = renderEvent(e.notification);
    return sendMessage({ chatId, html, replyMarkup });
  },

  // Render + send the daily digest from an assembled model. Same resolution
  // and result contract as sendEvent.
  async sendDigest(
    userId: string,
    d: DigestModel,
  ): Promise<DeliveryResult> {
    const chatId = await resolveChatId(userId);
    if (!chatId) return { status: "skipped" };

    const { html, replyMarkup } = renderDigest(d);
    return sendMessage({ chatId, html, replyMarkup });
  },
};
