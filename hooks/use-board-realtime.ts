"use client";
import { useEffect } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { useBoardStore } from "@/stores/board-store";
import type { ListRow, CardRow } from "@/lib/queries/board-snapshot";

function rowToList(r: Record<string, unknown>): ListRow {
  return {
    id: r.id as string,
    boardId: r.board_id as string,
    title: r.title as string,
    position: r.position as string,
    archived: r.archived as boolean,
    createdAt: new Date(r.created_at as string),
  };
}

function rowToCard(r: Record<string, unknown>): CardRow {
  return {
    id: r.id as string,
    listId: r.list_id as string,
    boardId: r.board_id as string,
    title: r.title as string,
    description: (r.description ?? null) as string | null,
    position: r.position as string,
    archived: r.archived as boolean,
    createdAt: new Date(r.created_at as string),
  };
}

export function useBoardRealtime(boardId: string) {
  const addList    = useBoardStore((s) => s.addList);
  const addCard    = useBoardStore((s) => s.addCard);
  const moveList   = useBoardStore((s) => s.moveList);
  const moveCard   = useBoardStore((s) => s.moveCard);
  const removeList = useBoardStore((s) => s.removeList);
  const removeCard = useBoardStore((s) => s.removeCard);
  const renameList = useBoardStore((s) => s.renameList);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    const channel = supa.channel(`board:${boardId}`);

    channel
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "lists",
          filter: `board_id=eq.${boardId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === "INSERT" && payload.new) {
            addList(rowToList(payload.new));
          } else if (payload.eventType === "UPDATE" && payload.new) {
            const r = payload.new;
            if (r.archived) {
              removeList(r.id);
            } else {
              if (r.position) moveList(r.id, r.position);
              if (typeof r.title === "string") renameList(r.id, r.title);
            }
          } else if (payload.eventType === "DELETE" && payload.old) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            removeList((payload.old as any).id);
          }
        },
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "cards",
          filter: `board_id=eq.${boardId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === "INSERT" && payload.new) {
            addCard(rowToCard(payload.new));
          } else if (payload.eventType === "UPDATE" && payload.new) {
            const r = payload.new;
            if (r.archived) {
              removeCard(r.id);
            } else if (r.list_id && r.position) {
              moveCard(r.id, r.list_id, r.position);
            }
          } else if (payload.eventType === "DELETE" && payload.old) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            removeCard((payload.old as any).id);
          }
        },
      )
      .subscribe();

    return () => {
      supa.removeChannel(channel);
    };
  }, [boardId, addList, addCard, moveList, moveCard, removeList, removeCard, renameList]);
}
