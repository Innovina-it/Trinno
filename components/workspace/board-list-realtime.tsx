"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Refreshes the server-rendered board grid when a workspace peer
// creates, renames, archives, or deletes a board. Without this, RLS
// surfaces the new row in DB but the SSR HTML stays stale until a
// manual reload. Pairs with `revalidatePath` in the board actions —
// that path only invalidates the actor's cache.
export function BoardListRealtime({ workspaceId }: { workspaceId: string }) {
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

      const ch = supa.channel(`ws-boards:${workspaceId}`);
      channel = ch;
      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "boards",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => router.refresh(),
      );
      ch.subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [workspaceId, router]);

  return null;
}
