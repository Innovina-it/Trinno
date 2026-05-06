"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Refresh the board route's RSC payload when `board_members` changes.
// Covers role changes, additions, and removals so the members panel
// and the topnav-side member chips stay live without a hard reload.
export function useBoardMembershipSync(boardId: string) {
  const router = useRouter();
  useEffect(() => {
    if (!boardId) return;
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`board_members:${boardId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "board_members",
            filter: `board_id=eq.${boardId}`,
          },
          () => router.refresh(),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [boardId, router]);
}
