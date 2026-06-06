"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setNotifyPerEvent } from "@/actions/user-notification-prefs";

// "Notify me on every event" — the per-user MASTER switch that gates
// per-event delivery on EXTERNAL channels (email + telegram). The in-app
// bell/inbox is always-on and unaffected.
//
// Server-rendered initial value (like EmailDigestToggle) so the checkbox
// doesn't flicker on mount. `channelAvailable` comes from
// hasExternalDeliveryChannel() on the server page: when false the control is
// disabled and persists NOTHING (no lying control). The server action also
// guards enabling, so this disabled-state is UX only.
export function NotifyPerEventToggle({
  initial,
  channelAvailable,
}: {
  initial: boolean;
  channelAvailable: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [, start] = useTransition();

  function onChange(next: boolean) {
    if (!channelAvailable) return; // never persists while unavailable
    setEnabled(next);
    start(async () => {
      try {
        await setNotifyPerEvent(next);
      } catch (err) {
        setEnabled(!next);
        toast.error((err as Error).message);
      }
    });
  }

  const hint = channelAvailable
    ? "Instant per-event pings on your connected channels."
    : "Connect Telegram to enable — email delivery isn’t active yet.";

  return (
    <label
      htmlFor="notify-per-event"
      className={`flex items-center gap-3 select-none ${
        channelAvailable
          ? "cursor-pointer"
          : "opacity-60 cursor-not-allowed"
      }`}
    >
      <input
        id="notify-per-event"
        type="checkbox"
        checked={enabled}
        disabled={!channelAvailable}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-fg font-medium">
          Notify me on every event
        </span>
        <span className="block mono-meta-sm text-fg-faint">{hint}</span>
      </span>
    </label>
  );
}
