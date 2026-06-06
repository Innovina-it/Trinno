// Channel abstraction for notification delivery.
//
// A NotificationChannel knows how to deliver a single event or a daily
// digest to a user over one transport (email today; telegram reserved for
// a later unit).  A ChannelLinker handles the link/unlink handshake for
// channels that need an external identity (telegram).  Email needs no
// linker — the identity is the auth.users.email already on file.
//
// The data passed to channels is channel-NEUTRAL: per-event we pass the
// raw notification row (RenderableEvent); for the digest we pass the
// already-assembled, render-agnostic DigestModel.  Each channel renders
// its own wire format from that data.

// telegram is reserved for a later unit; it is intentionally part of the
// id union so types line up, but no telegram channel is registered yet.
export type ChannelId = "email" | "telegram";

export type DeliveryResult = {
  status: "sent" | "skipped" | "failed";
  error?: string;
};

// The per-event notification row already used by the email pipeline
// (lib/notify-email.ts).  Kept structurally identical so channels render
// from the same shape the send loop fetched.
export type NotificationRow = {
  id: string;
  recipient_user_id: string;
  kind: string;
  related_card_id: string | null;
  related_board_id: string | null;
  actor_user_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// One assembled digest, channel-neutral.  Mirrors the structured data
// lib/notifications/email-digest.ts assembles BEFORE rendering HTML:
// grouped sections (by kind, then by card/board) with resolved labels +
// links, plus the date string and total used in the subject.  The exact
// values are derived from the existing builder so rendering is identical.
export type DigestSectionItem = {
  label: string;
  href: string;
};

export type DigestSection = {
  heading: string;
  items: DigestSectionItem[];
};

export type DigestModel = {
  userId: string;
  dateStr: string;
  total: number;
  sections: DigestSection[];
  baseUrl: string;
  notificationIds: string[];
};

export type RenderableEvent = {
  notification: NotificationRow;
};

export interface NotificationChannel {
  id: ChannelId;
  isLinked(userId: string): Promise<boolean>;
  sendEvent(userId: string, e: RenderableEvent): Promise<DeliveryResult>;
  sendDigest(userId: string, d: DigestModel): Promise<DeliveryResult>;
}

export interface ChannelLinker {
  id: ChannelId;
  startLink(userId: string): Promise<{ url: string; expiresAt: string }>;
  unlink(userId: string): Promise<void>;
}
