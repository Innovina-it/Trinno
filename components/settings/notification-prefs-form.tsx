"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  listNotificationPrefs,
  setNotificationPref,
} from "@/actions/user-notification-prefs";

export type Kind = { kind: string; label: string; desc: string };

export function NotificationPrefsForm({ kinds }: { kinds: Kind[] }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [, start] = useTransition();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listNotificationPrefs()
      .then((rows) => {
        const map: Record<string, boolean> = {};
        for (const r of rows) {
          if (r.channel === "in_app") map[r.kind] = r.enabled;
        }
        setPrefs(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function toggle(kind: string, next: boolean) {
    setPrefs((p) => ({ ...p, [kind]: next }));
    start(async () => {
      try {
        await setNotificationPref({ kind, channel: "in_app", enabled: next });
      } catch (err) {
        // Rollback on error.
        setPrefs((p) => ({ ...p, [kind]: !next }));
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div
      className="rounded-xl border border-hairline bg-[color:var(--surface)] divide-y divide-hairline overflow-hidden"
      aria-busy={loading}
    >
      {kinds.map((k) => {
        const id = `kind-${k.kind}`;
        // Default to enabled when no row exists.
        const checked = prefs[k.kind] !== false;
        return (
          <label
            key={k.kind}
            htmlFor={id}
            className="flex items-center gap-3 cursor-pointer select-none px-4 py-3"
          >
            <input
              id={id}
              type="checkbox"
              checked={checked}
              onChange={(e) => toggle(k.kind, e.target.checked)}
              className="size-4 rounded-sm border border-hairline-hi bg-[color:var(--surface-strong)] accent-fg shrink-0"
            />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-fg font-medium">{k.label}</span>
              <span className="block mono-meta-sm text-fg-faint">{k.desc}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
