"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

// Plan #links — refreshes the server-rendered surface when a workspace peer
// adds, recolors, or removes a per-card URL link. Without this, the link
// diamond only updates for the actor; peers keep the SSR-stale map until a
// manual reload. router.refresh() re-runs the server components, producing a
// fresh snapshot whose cardLinkByCard the store providers reconcile into the
// live store. Mirrors board-list-realtime.tsx's channel + auth + nonce +
// cleanup pattern. The `links` table is in the realtime publication with
// replica identity full and carries a trigger-filled workspace_id.
export function LinksRealtime({ workspaceId }: { workspaceId: string }) {
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

      // Per-mount nonce: Supabase JS caches channels by name, so under
      // React StrictMode the effect's double-mount returns the
      // already-subscribed handle from the first run and `.on()` fails.
      const nonce = Math.random().toString(36).slice(2, 8);
      const ch = supa.channel(`links:${workspaceId}:${nonce}`);
      channel = ch;
      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "links",
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
