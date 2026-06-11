"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Live-sync against `workspace_members` changes — covers a concurrent
// admin's invite, role change, or removal in another tab. Default
// reaction is router.refresh(); callers can pass `onEvent` to react
// granularly instead (e.g. a targeted refetch that patches local state
// without re-rendering the route).
export function useWorkspaceMembersSync(
  workspaceId: string,
  onEvent?: () => void,
) {
  const router = useRouter();
  // Ref keeps the subscription stable when callers pass an inline arrow.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    if (!workspaceId) return;
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`ws_members:${workspaceId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "workspace_members",
            filter: `workspace_id=eq.${workspaceId}`,
          },
          () => {
            const fn = onEventRef.current;
            if (fn) fn();
            else router.refresh();
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [workspaceId, router]);
}
