"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { CreateSprintDialog } from "@/components/sprint/create-sprint-dialog";
import { SprintCard } from "@/components/sprint/sprint-card";
import { BacklogList } from "@/components/sprint/backlog-list";
import type { SprintLite } from "@/components/sprint/sprint-picker";

// Plan #16b-α (β concern fix) — backlog page now reads sprints + cards
// from the workspace store instead of from server-shaped props. Realtime
// CDC echoes propagate live across tabs, so dragging a card from the
// backlog into a sprint shows up immediately in other open tabs.
//
// The server still seeds the store via WorkspaceStoreProvider; this
// client just composes per-sprint groupings + the SprintCard rows.

export function BacklogClient({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const { subscribed } = useWorkspaceRealtime(workspaceId);
  const cards = useWorkspaceStore((s) => s.cards);
  const sprints = useWorkspaceStore((s) => s.sprints);
  const boards = useWorkspaceStore((s) => s.boards);

  const allSprints: SprintLite[] = useMemo(
    () =>
      sprints.map((s) => ({
        id: s.id,
        name: s.name,
        state: s.state as SprintLite["state"],
      })),
    [sprints],
  );
  const sprintsTyped = useMemo(
    () =>
      sprints.map((s) => ({
        id: s.id,
        name: s.name,
        goal: s.goal,
        state: s.state as "planned" | "active" | "completed",
        startDate: s.startDate,
        endDate: s.endDate,
      })),
    [sprints],
  );
  const active = sprintsTyped.find((s) => s.state === "active");
  const planned = sprintsTyped.filter((s) => s.state === "planned");
  const completed = sprintsTyped.filter((s) => s.state === "completed");
  const boardTitleById = useMemo(
    () => new Map(boards.map((b) => [b.id, b.title])),
    [boards],
  );

  type SprintCardRow = {
    id: string;
    title: string;
    boardId: string;
    boardTitle: string;
    sprintId: string | null;
    storyPoints?: number | null;
    archived?: boolean;
  };

  const cardsBySprint = useMemo(() => {
    const map = new Map<string | null, SprintCardRow[]>();
    for (const c of cards) {
      const k = c.sprintId ?? null;
      const arr = map.get(k) ?? [];
      arr.push({
        id: c.id,
        title: c.title,
        boardId: c.boardId,
        boardTitle: boardTitleById.get(c.boardId) ?? "",
        sprintId: c.sprintId,
        storyPoints: c.storyPoints,
        archived: c.archived,
      });
      map.set(k, arr);
    }
    return map;
  }, [cards, boardTitleById]);

  const backlogCards = useMemo(
    () => (cardsBySprint.get(null) ?? []).filter((c) => !c.archived),
    [cardsBySprint],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">{workspaceName.toUpperCase()} / BACKLOG</span>
        <h1 className="serif-display text-5xl">Sprints &amp; backlog</h1>
        <div className="flex justify-between items-center gap-3">
          <Link
            href={`/w/${workspaceId}`}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← Back to workspace
          </Link>
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 mono-meta-sm text-fg-faint"
              data-testid="backlog-live"
              data-live={subscribed ? "true" : "false"}
              title={subscribed ? "Realtime sync active" : "Realtime sync offline"}
            >
              <span
                aria-hidden
                className={`inline-block size-1.5 rounded-full ${
                  subscribed ? "bg-emerald-400 animate-pulse" : "bg-fg/20"
                }`}
              />
              {subscribed ? "LIVE" : "OFFLINE"}
            </span>
            <CreateSprintDialog workspaceId={workspaceId} />
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">ACTIVE SPRINT</h2>
        {active ? (
          <SprintCard
            sprint={active}
            cards={cardsBySprint.get(active.id) ?? []}
            allSprints={allSprints}
            workspaceId={workspaceId}
          />
        ) : (
          <p className="text-sm text-fg-faint italic">
            No active sprint. Start one from the planned list.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">PLANNED ({planned.length})</h2>
        <div className="space-y-3">
          {planned.map((s) => (
            <SprintCard
              key={s.id}
              sprint={s}
              cards={cardsBySprint.get(s.id) ?? []}
              allSprints={allSprints}
              workspaceId={workspaceId}
              activeExists={Boolean(active)}
            />
          ))}
          {planned.length === 0 && (
            <p className="text-sm text-fg-faint italic">No planned sprints.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">
          BACKLOG ({backlogCards.length})
        </h2>
        <BacklogList cards={backlogCards} sprints={allSprints} />
      </section>

      {completed.length > 0 && (
        <section className="space-y-3 opacity-70">
          <h2 className="mono-meta text-fg-muted">
            COMPLETED ({completed.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {completed.map((s) => (
              <li
                key={s.id}
                className="border border-hairline rounded-lg p-3"
              >
                <span className="font-medium">{s.name}</span>
                {s.endDate && (
                  <span className="ml-2 mono-meta-sm text-fg-faint">
                    {new Date(s.endDate).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
