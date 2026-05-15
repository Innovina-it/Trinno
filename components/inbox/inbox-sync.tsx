"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Keep the SSR-rendered /inbox list live: subscribe to `notifications`
// CDC for the signed-in user and refresh the route on every change so
// new arrivals, read-state flips, and bulk markings show without a
// manual reload.
export function InboxSync({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!userId) return;
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    // Per-mount nonce: Supabase JS caches channels by name → StrictMode
    // double-mount returns already-subscribed handle → `.on()` fails.
    const nonce = Math.random().toString(36).slice(2, 8);
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`inbox:${userId}:${nonce}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `recipient_user_id=eq.${userId}`,
          },
          () => router.refresh(),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [userId, router]);
  return null;
}
