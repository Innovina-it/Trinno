"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { useWorkspaceStore, type WorkspaceState } from "@/stores/workspace-store";

// Plan #16b-β — single Supabase realtime channel keyed `ws:{workspaceId}`,
// fanning out CDC events into the per-workspace store. `postgres_changes`
// only supports `eq` filters, so we register N filters per board for the
// per-board tables (cards, card_links). Workspace-scoped tables (sprints,
// versions, card_versions) get one filter each via `workspace_id=eq.<id>`.
//
// Unlike the per-board hook, we don't dedupe inverse `card_links` mirror
// rows here — they share the same kind ("blocks" vs "is_blocked_by") but
// have distinct `id`s, and `upsertCardLink` is idempotent on `id`. Both
// directions render correctly in the dependency-arrows logic.

type CardSnap = WorkspaceState["cards"][number];

function rowToCard(r: Record<string, unknown>, boardId: string): CardSnap {
  return {
    id: r.id as string,
    boardId,
    listId: r.list_id as string,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    type: (r.type as string) ?? "task",
    parentCardId: (r.parent_card_id as string | null) ?? null,
    sprintId: (r.sprint_id as string | null) ?? null,
    storyPoints: (r.story_points as number | null) ?? null,
    startDate: r.start_date ? new Date(r.start_date as string) : null,
    targetDate: r.target_date ? new Date(r.target_date as string) : null,
    dueDate: r.due_date ? new Date(r.due_date as string) : null,
    dueComplete: Boolean(r.due_complete),
    archived: Boolean(r.archived),
    createdAt: r.created_at ? new Date(r.created_at as string) : new Date(),
  };
}

export function useWorkspaceRealtime(workspaceId: string) {
  const upsertCard = useWorkspaceStore((s) => s.upsertCard);
  const patchCard = useWorkspaceStore((s) => s.patchCard);
  const removeCard = useWorkspaceStore((s) => s.removeCard);
  const upsertList = useWorkspaceStore((s) => s.upsertList);
  const patchList = useWorkspaceStore((s) => s.patchList);
  const removeList = useWorkspaceStore((s) => s.removeList);
  const upsertSprint = useWorkspaceStore((s) => s.upsertSprint);
  const patchSprint = useWorkspaceStore((s) => s.patchSprint);
  const removeSprint = useWorkspaceStore((s) => s.removeSprint);
  const upsertVersion = useWorkspaceStore((s) => s.upsertVersion);
  const patchVersion = useWorkspaceStore((s) => s.patchVersion);
  const removeVersion = useWorkspaceStore((s) => s.removeVersion);
  const upsertCardLink = useWorkspaceStore((s) => s.upsertCardLink);
  const removeCardLink = useWorkspaceStore((s) => s.removeCardLink);
  const upsertCardVersion = useWorkspaceStore((s) => s.upsertCardVersion);
  const removeCardVersion = useWorkspaceStore((s) => s.removeCardVersion);
  const boards = useWorkspaceStore((s) => s.boards);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (boards.length === 0) {
      setSubscribed(false);
      return;
    }
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;

    (async () => {
      // Mirror `useBoardRealtime`: pass the user's JWT to realtime so
      // `postgres_changes` evaluates RLS as the JWT subject.
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;

      const ch = supa.channel(`ws:${workspaceId}`);
      channel = ch;

      for (const b of boards) {
        ch.on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "lists",
            filter: `board_id=eq.${b.id}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              const r = payload.new as Record<string, unknown>;
              upsertList({
                id: r.id as string,
                boardId: b.id,
                title: r.title as string,
                statusKind:
                  (r.status_kind as
                    | "todo"
                    | "in_progress"
                    | "review"
                    | "done"
                    | "blocked"
                    | null) ?? null,
              });
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const r = payload.new as Record<string, unknown>;
              if (r.archived) {
                removeList(r.id as string);
              } else {
                patchList(r.id as string, {
                  title: r.title as string,
                  statusKind:
                    (r.status_kind as
                      | "todo"
                      | "in_progress"
                      | "review"
                      | "done"
                      | "blocked"
                      | null) ?? null,
                });
              }
            } else if (payload.eventType === "DELETE" && payload.old) {
              removeList((payload.old as { id: string }).id);
            }
          },
        );
        ch.on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "cards",
            filter: `board_id=eq.${b.id}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              upsertCard(rowToCard(payload.new, b.id));
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const next = rowToCard(payload.new, b.id);
              patchCard(next.id, next);
            } else if (payload.eventType === "DELETE" && payload.old) {
              removeCard((payload.old as { id: string }).id);
            }
          },
        );
        ch.on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "card_links",
            filter: `board_id=eq.${b.id}`,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            if (payload.eventType === "INSERT" && payload.new) {
              const r = payload.new as Record<string, unknown>;
              upsertCardLink({
                id: r.id as string,
                fromCardId: r.from_card_id as string,
                toCardId: r.to_card_id as string,
                kind: r.kind as string,
                boardId: b.id,
              });
            } else if (payload.eventType === "DELETE" && payload.old) {
              removeCardLink((payload.old as { id: string }).id);
            }
          },
        );
      }

      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "sprints",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === "INSERT" && payload.new) {
            const r = payload.new as Record<string, unknown>;
            upsertSprint({
              id: r.id as string,
              name: r.name as string,
              goal: (r.goal as string | null) ?? null,
              startDate: r.start_date
                ? new Date(r.start_date as string)
                : null,
              endDate: r.end_date ? new Date(r.end_date as string) : null,
              state: r.state as string,
            });
          } else if (payload.eventType === "UPDATE" && payload.new) {
            const r = payload.new as Record<string, unknown>;
            patchSprint(r.id as string, {
              name: r.name as string,
              goal: (r.goal as string | null) ?? null,
              startDate: r.start_date
                ? new Date(r.start_date as string)
                : null,
              endDate: r.end_date ? new Date(r.end_date as string) : null,
              state: r.state as string,
            });
          } else if (payload.eventType === "DELETE" && payload.old) {
            removeSprint((payload.old as { id: string }).id);
          }
        },
      );

      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "versions",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === "INSERT" && payload.new) {
            const r = payload.new as Record<string, unknown>;
            upsertVersion({
              id: r.id as string,
              name: r.name as string,
              semver: (r.semver as string | null) ?? null,
              state: r.state as string,
              releaseDate: r.release_date
                ? new Date(r.release_date as string)
                : null,
            });
          } else if (payload.eventType === "UPDATE" && payload.new) {
            const r = payload.new as Record<string, unknown>;
            patchVersion(r.id as string, {
              name: r.name as string,
              semver: (r.semver as string | null) ?? null,
              state: r.state as string,
              releaseDate: r.release_date
                ? new Date(r.release_date as string)
                : null,
            });
          } else if (payload.eventType === "DELETE" && payload.old) {
            removeVersion((payload.old as { id: string }).id);
          }
        },
      );

      ch.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "card_versions",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === "INSERT" && payload.new) {
            const r = payload.new as Record<string, unknown>;
            upsertCardVersion({
              cardId: r.card_id as string,
              versionId: r.version_id as string,
              kind: r.kind as string,
            });
          } else if (payload.eventType === "DELETE" && payload.old) {
            const r = payload.old as Record<string, unknown>;
            removeCardVersion(
              r.card_id as string,
              r.version_id as string,
              r.kind as string,
            );
          }
        },
      );

      ch.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") setSubscribed(true);
        else if (status === "CLOSED" || status === "CHANNEL_ERROR")
          setSubscribed(false);
      });
    })();

    return () => {
      cancelled = true;
      setSubscribed(false);
      if (channel) supa.removeChannel(channel);
    };
  }, [
    workspaceId,
    boards,
    upsertCard,
    patchCard,
    removeCard,
    upsertList,
    patchList,
    removeList,
    upsertSprint,
    patchSprint,
    removeSprint,
    upsertVersion,
    patchVersion,
    removeVersion,
    upsertCardLink,
    removeCardLink,
    upsertCardVersion,
    removeCardVersion,
  ]);

  return { subscribed };
}
