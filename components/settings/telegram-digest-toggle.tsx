"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setNotificationPref } from "@/actions/user-notification-prefs";

// Telegram daily digest opt-in.  Mirrors EmailDigestToggle, but persists into
// user_notification_prefs (kind="digest.daily", channel="telegram") rather
// than a profiles column.  Server-rendered initial value.
//
// When the user has not linked Telegram (`linked === false`) the control is
// disabled with a "connect first" hint and persists nothing — there is no
// channel to deliver the digest to yet.
export function TelegramDigestToggle({
  initial,
  linked,
}: {
  initial: boolean;
  linked: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [, start] = useTransition();

  function onChange(next: boolean) {
    if (!linked) return; // never persists while unlinked
    setEnabled(next);
    start(async () => {
      try {
        await setNotificationPref({
          kind: "digest.daily",
          channel: "telegram",
          enabled: next,
        });
      } catch (err) {
        setEnabled(!next);
        toast.error((err as Error).message);
      }
    });
  }

  const hint = linked
    ? "One summary message grouping the day’s updates, sent to Telegram."
    : "Connect Telegram first to receive a daily digest there.";

  return (
    <label
      htmlFor="telegram-digest"
      className={`flex items-center gap-3 select-none ${
        linked ? "cursor-pointer" : "opacity-60 cursor-not-allowed"
      }`}
    >
      <input
        id="telegram-digest"
        type="checkbox"
        checked={enabled}
        disabled={!linked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-fg font-medium">
          Telegram daily digest
        </span>
        <span className="block mono-meta-sm text-fg-faint">{hint}</span>
      </span>
    </label>
  );
}
