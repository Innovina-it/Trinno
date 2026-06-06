import { emailChannel } from "@/lib/notifications/channels/email";
import { telegramChannel } from "@/lib/notifications/channels/telegram";
import { telegramLinker } from "@/lib/notifications/channels/telegram/linker";
import type {
  ChannelId,
  ChannelLinker,
  NotificationChannel,
} from "@/lib/notifications/channels/types";

// Registry of notification delivery channels.  Email and telegram are the
// send transports today.  Telegram is PURE send + render here; its linker
// (account-link handshake) is now wired, while the webhook and cron land via
// their own routes/units.  Crons do NOT loop this registry yet either.

export const channels: NotificationChannel[] = [emailChannel, telegramChannel];

export const linkers: Partial<Record<ChannelId, ChannelLinker>> = {
  telegram: telegramLinker,
};
