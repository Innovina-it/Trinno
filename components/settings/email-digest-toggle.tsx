"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setEmailDigestPref } from "@/actions/user-notification-prefs";

// Single global toggle for the daily email digest.  Initial value is
// passed in by the server-rendered settings page so the checkbox doesn't
// flicker on mount.
export function EmailDigestToggle({
  initial,
}: {
  initial: boolean;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [, start] = useTransition();

  function onChange(next: boolean) {
    setEnabled(next);
    start(async () => {
      try {
        await setEmailDigestPref(next);
      } catch (err) {
        setEnabled(!next);
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <label
      htmlFor="email-digest"
      className="flex items-center gap-3 cursor-pointer select-none"
    >
      <input
        id="email-digest"
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-fg font-medium">
          Email daily digest
        </span>
        <span className="block mono-meta-sm text-fg-faint">
          One summary email grouping the day&rsquo;s updates. Daily digest sends
          at 09:00 UTC.
        </span>
      </span>
    </label>
  );
}
