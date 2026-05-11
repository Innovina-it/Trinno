"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export type Viewer = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  location?: "board" | "card";
  cardId?: string | null;
  cardTitle?: string | null;
  lastSeenAt?: string;
};

export function useBoardPresence(boardId: string, me: Viewer) {
  const [viewers, setViewers] = useState<Viewer[]>([]);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    const channel = supa.channel(`board:${boardId}:presence`, {
      config: { presence: { key: me.userId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Viewer[]>;
      const all: Viewer[] = [];
      for (const key of Object.keys(state)) {
        for (const meta of state[key]) all.push(meta);
      }
      const seen = new Set<string>();
      const unique = all.filter((v) =>
        seen.has(v.userId) ? false : (seen.add(v.userId), true),
      );
      setViewers(unique);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          userId: me.userId,
          displayName: me.displayName,
          avatarUrl: me.avatarUrl,
          location: me.location ?? "board",
          cardId: me.cardId ?? null,
          cardTitle: me.cardTitle ?? null,
          lastSeenAt: new Date().toISOString(),
        });
      }
    });

    return () => { supa.removeChannel(channel); };
  }, [
    boardId,
    me.userId,
    me.displayName,
    me.avatarUrl,
    me.location,
    me.cardId,
    me.cardTitle,
  ]);

  return viewers;
}
