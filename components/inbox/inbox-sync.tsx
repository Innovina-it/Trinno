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
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`inbox:${userId}`)
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
