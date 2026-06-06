import { createHash, randomBytes } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase/service-role";
import { StructuredError } from "@/lib/errors";
import type { ChannelLinker } from "@/lib/notifications/channels/types";

// Telegram account-linking handshake (start/unlink) for the telegram channel.
//
// Scope (this unit): mint/revoke the link token on user_channel_links. The
// inbound /api/telegram/webhook route COMPLETES a link (pending -> linked);
// no send/cron/dispatcher wiring here.
//
// DB path: these helpers run with the service-role Supabase client
// (getServiceSupabase) rather than dbAsUser. The webhook that completes the
// link has NO user JWT, so the channel-generic table is touched service-side
// throughout for consistency; startLink/unlink are passed an already-resolved
// userId by their server-action callers, which is the RLS boundary. The
// service client is constructed LAZILY (no env read at module top-level).
//
// SECURITY: the plaintext token is returned to the caller ONCE (embedded in
// the t.me deep-link) and is NEVER stored — only its sha256 hex hash lands in
// link_token_hash. The webhook re-hashes the inbound /start token to match.

const LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REMINT_COOLDOWN_MS = 30 * 1000; // refuse re-mint within 30s of last mint

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function startLink(
  userId: string,
): Promise<{ url: string; expiresAt: string }> {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername) {
    throw new StructuredError(
      "TELEGRAM_NOT_CONFIGURED",
      "TELEGRAM_BOT_USERNAME is not configured.",
    );
  }

  const sb = getServiceSupabase();

  // Rate-limit: if a still-pending token for this user was minted less than
  // 30s ago, REFUSE. We cannot reuse-and-return the prior link because the
  // plaintext token is never persisted, so a reuse path could only hand back
  // a dead URL. Refusing is the honest behavior; the UI debounces on it.
  const { data: existing } = await sb
    .from("user_channel_links")
    .select("link_token_exp, status")
    .eq("user_id", userId)
    .eq("channel", "telegram")
    .maybeSingle();

  if (existing?.status === "pending" && existing.link_token_exp) {
    const mintedAtApproxMs =
      new Date(existing.link_token_exp).getTime() - LINK_TTL_MS;
    if (Date.now() - mintedAtApproxMs < REMINT_COOLDOWN_MS) {
      throw new StructuredError(
        "RATE_LIMITED",
        "A link was just generated. Wait a few seconds and try again.",
      );
    }
  }

  const token = randomBytes(32).toString("base64url");
  const hash = sha256hex(token);
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

  // Upsert on the (user_id, channel) primary key: reset to a fresh pending
  // handshake, clearing any prior external_id so a re-link starts clean.
  const { error } = await sb.from("user_channel_links").upsert(
    {
      user_id: userId,
      channel: "telegram",
      external_id: null,
      link_token_hash: hash,
      link_token_exp: expiresAt,
      status: "pending",
      linked_at: null,
    },
    { onConflict: "user_id,channel" },
  );
  if (error) {
    throw new StructuredError(
      "TELEGRAM_LINK_START_FAILED",
      error.message,
      error,
    );
  }

  return {
    url: `https://t.me/${botUsername}?start=${token}`,
    expiresAt,
  };
}

async function unlink(userId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb
    .from("user_channel_links")
    .update({
      status: "revoked",
      external_id: null,
      link_token_hash: null,
      link_token_exp: null,
    })
    .eq("user_id", userId)
    .eq("channel", "telegram");
  if (error) {
    throw new StructuredError("TELEGRAM_UNLINK_FAILED", error.message, error);
  }
}

export const telegramLinker: ChannelLinker = {
  id: "telegram",
  startLink,
  unlink,
};
