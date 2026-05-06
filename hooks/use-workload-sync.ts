"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Refresh the /workload route's RSC payload when anything that affects
// the cross-workspace lane view changes.  The workload page is a pure
// Server Component that re-runs `listWorkload` on each request, so a
// router.refresh() is enough.
//
// We don't filter by board_id here — workload spans every board the
// viewer can see across every workspace.  Subscribe broadly and let
// router.refresh() coalesce the cost.
export function useWorkloadSync() {
  const router = useRouter();
  useEffect(() => {
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel("workload-sync")
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "cards" },
          () => router.refresh(),
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "card_members" },
          () => router.refresh(),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [router]);
}
