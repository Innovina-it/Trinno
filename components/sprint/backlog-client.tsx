"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { CreateSprintDialog } from "@/components/sprint/create-sprint-dialog";
import { SprintCard } from "@/components/sprint/sprint-card";
import { BacklogList } from "@/components/sprint/backlog-list";
import { formatDate } from "@/lib/format-date";
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
  canManageSprints,
}: {
  workspaceId: string;
  workspaceName: string;
  canManageSprints: boolean;
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
    completedAt?: Date | string | null;
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
        completedAt: (c as { completedAt?: Date | string | null }).completedAt ?? null,
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
      <header className="space-y-2 border-b border-hairline pb-4">
        <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
          <Link
            href={`/w/${workspaceId}`}
            className="hover:text-fg"
          >
            {workspaceName.toUpperCase()}
          </Link>
          <span>/</span>
          <span className="text-fg">SPRINTS</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
            Sprints
          </h1>
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
                  subscribed ? "bg-emerald-400" : "bg-fg/20"
                }`}
              />
              {subscribed ? "Live" : "Offline"}
            </span>
            {canManageSprints && (
              <CreateSprintDialog workspaceId={workspaceId} />
            )}
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
            canManageSprints={canManageSprints}
          />
        ) : (
          <div className="rounded-xl border border-hairline bg-[color:var(--surface)] px-4 py-6 text-center space-y-1">
            <p className="mono-meta-sm text-fg-faint">NO ACTIVE SPRINT</p>
            <p className="text-sm text-fg-muted">
              Start one from the planned list below.
            </p>
          </div>
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
              canManageSprints={canManageSprints}
            />
          ))}
          {planned.length === 0 && (
            <p className="text-sm text-fg-faint">No planned sprints.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">
          BACKLOG ({backlogCards.length})
        </h2>
        <BacklogList
          cards={backlogCards}
          sprints={allSprints}
          canManageSprints={canManageSprints}
        />
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
                    {formatDate(s.endDate)}
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
