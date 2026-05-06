"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  listNotificationPrefs,
  setNotificationPref,
} from "@/actions/user-notification-prefs";

export type Kind = { kind: string; label: string; desc: string };
type Channel = "in_app" | "email";

export function NotificationPrefsForm({ kinds }: { kinds: Kind[] }) {
  // Map<channel, Map<kind, enabled>>.  in_app defaults TRUE when no row
  // exists; email defaults FALSE (opt-in).
  const [inApp, setInApp] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState<Record<string, boolean>>({});
  const [, start] = useTransition();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listNotificationPrefs()
      .then((rows) => {
        const a: Record<string, boolean> = {};
        const e: Record<string, boolean> = {};
        for (const r of rows) {
          if (r.channel === "in_app") a[r.kind] = r.enabled;
          else if (r.channel === "email") e[r.kind] = r.enabled;
        }
        setInApp(a);
        setEmail(e);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function toggle(channel: Channel, kind: string, next: boolean) {
    const setter = channel === "in_app" ? setInApp : setEmail;
    setter((p) => ({ ...p, [kind]: next }));
    start(async () => {
      try {
        await setNotificationPref({ kind, channel, enabled: next });
      } catch (err) {
        setter((p) => ({ ...p, [kind]: !next }));
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div
      className="rounded-xl border border-hairline bg-[color:var(--surface)] overflow-hidden"
      aria-busy={loading}
    >
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2 border-b border-hairline mono-meta-sm text-fg-faint">
        <span>EVENT</span>
        <span className="w-16 text-center">IN-APP</span>
        <span className="w-16 text-center">EMAIL</span>
      </div>
      {kinds.map((k) => {
        // Default in-app = enabled when no row.  Default email = OFF.
        const inAppOn = inApp[k.kind] !== false;
        const emailOn = email[k.kind] === true;
        return (
          <div
            key={k.kind}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 border-t border-hairline first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block text-sm text-fg font-medium">
                {k.label}
              </span>
              <span className="block mono-meta-sm text-fg-faint">{k.desc}</span>
            </span>
            <span className="w-16 flex justify-center">
              <input
                type="checkbox"
                aria-label={`In-app: ${k.label}`}
                checked={inAppOn}
                onChange={(e) => toggle("in_app", k.kind, e.target.checked)}
                className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg"
              />
            </span>
            <span className="w-16 flex justify-center">
              <input
                type="checkbox"
                aria-label={`Email: ${k.label}`}
                checked={emailOn}
                onChange={(e) => toggle("email", k.kind, e.target.checked)}
                className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg"
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
