"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Refresh the RSC payload (which re-runs `listActivityForBoard`) when a
// new `activity` row appears for this board. The ActivityFeed itself is
// a Server Component — this hook is the live channel.
export function useActivitySync(boardId: string) {
  const router = useRouter();
  // Keep a stable ref to router so removing it from the dep array is safe.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    if (!boardId) return;
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    // Debounce timer ref — coalesces INSERT bursts to a single refresh.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`activity:${boardId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "INSERT",
            schema: "public",
            table: "activity",
            filter: `board_id=eq.${boardId}`,
          },
          () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              routerRef.current.refresh();
            }, 250);
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) supa.removeChannel(channel);
    };
  }, [boardId]);
}
