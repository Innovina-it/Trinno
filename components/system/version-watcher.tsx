"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { isClientStale } from "@/lib/version/skew";

// Baked in at build time (next.config.ts maps VERCEL_DEPLOYMENT_ID). Empty
// locally / when System Environment Variables are off → watcher is inert.
const OWN_ID = process.env.NEXT_PUBLIC_DEPLOYMENT_ID ?? "";

// Backstop poll. The primary triggers are tab focus + route change, which
// catch the common "user came back to an old tab" case immediately; this
// interval just bounds worst-case detection latency for a tab left in the
// foreground untouched.
const POLL_MS = 5 * 60 * 1000;
const TOAST_ID = "version-skew";

async function fetchLiveId(signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store", signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    // Aborted (navigation), offline, or 401 (session expired) — can't tell,
    // so stay quiet rather than nag on a false signal.
    return null;
  }
}

/**
 * Watches for a new production deployment and, when the running tab is
 * stale, shows a persistent "reload to update" toast. Manual reload only —
 * never force-reloads, so in-progress card edits / open dialogs are safe.
 * Skew Protection (enabled on the Vercel project) keeps the stale tab
 * working until the user reloads.
 */
export function VersionWatcher() {
  const pathname = usePathname();
  const notified = useRef(false);

  useEffect(() => {
    if (!OWN_ID) return;

    let cancelled = false;
    const ac = new AbortController();

    async function check() {
      if (notified.current || cancelled) return;
      const liveId = await fetchLiveId(ac.signal);
      if (cancelled || !isClientStale(OWN_ID, liveId)) return;
      notified.current = true;
      toast("New version available", {
        id: TOAST_ID,
        description: "Reload to update to the latest version.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => window.location.reload(),
        },
        cancel: { label: "Later", onClick: () => {} },
      });
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    window.addEventListener("focus", onVisibility);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => void check(), POLL_MS);

    return () => {
      cancelled = true;
      ac.abort();
      window.removeEventListener("focus", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [pathname]);

  return null;
}
