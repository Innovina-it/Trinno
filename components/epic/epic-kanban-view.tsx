"use client";
import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { groupChildrenByStatus } from "@/lib/epic/group-children-by-status";
import type { StatusKind } from "@/lib/status";
import { EpicStatusColumn } from "./epic-status-column";
import { EpicHeader } from "./epic-header";
import { moveCardToStatus } from "@/actions/cards";
import { errorBus } from "@/lib/errors/error-bus";
import { toast } from "sonner";
import { CardTile } from "@/components/board/card-tile";
import type { CardRow } from "@/lib/queries/board-snapshot";

const STATUS_ORDER: StatusKind[] = [
  "todo",
  "in_progress",
  "review",
  "done",
  "blocked",
];

export function EpicKanbanView({
  workspaceId,
  epicId,
}: {
  workspaceId: string;
  epicId: string;
}) {
  const epic = useBoardStore((s) => s.cards.find((c) => c.id === epicId));
  const allCards = useBoardStore((s) => s.cards);
  const updateCard = useBoardStore((s) => s.updateCard);
  const lists = useWorkspaceStore((s) => s.lists);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const children = useMemo(
    () => (epic ? allCards.filter((c) => c.parentCardId === epic.id) : []),
    [allCards, epic],
  );
  const buckets = useMemo(
    () =>
      groupChildrenByStatus(
        children,
        lists.filter((l) => epic && l.boardId === epic.boardId),
      ),
    [children, lists, epic],
  );

  const doneCount = buckets.done.length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const activeCard = activeCardId
    ? allCards.find((c) => c.id === activeCardId)
    : null;

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as
      | { type: "card"; cardId: string }
      | undefined;
    if (data?.type === "card") setActiveCardId(data.cardId);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveCardId(null);
    const overData = e.over?.data.current as
      | { type: "epicStatusColumn"; statusKind: StatusKind | "unmapped" }
      | undefined;
    if (!overData || overData.type !== "epicStatusColumn") return;
    if (overData.statusKind === "unmapped") return;
    const activeData = e.active.data.current as
      | { type: "card"; cardId: string; listId: string }
      | undefined;
    if (!activeData || activeData.type !== "card") return;

    const card = allCards.find((c) => c.id === activeData.cardId);
    if (!card) return;
    const previousListId = card.listId;
    const targetList = lists.find(
      (l) =>
        epic &&
        l.boardId === epic.boardId &&
        l.statusKind === overData.statusKind,
    );
    if (targetList) updateCard(card.id, { listId: targetList.id });

    try {
      await moveCardToStatus({
        cardId: activeData.cardId,
        statusKind: overData.statusKind,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Move failed";
      toast.error(msg);
      errorBus.push({ message: `Status move failed: ${msg}` });
      updateCard(card.id, { listId: previousListId });
    }
  }

  if (!epic) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-12 text-center space-y-2">
          <p className="mono-meta-sm text-fg-faint">EPIC NOT FOUND</p>
          <p className="text-sm text-fg-muted">
            It may have been archived or moved to another workspace.
          </p>
        </div>
      </div>
    );
  }

  const isEmpty = children.length === 0;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-5 px-6 py-6">
      <EpicHeader
        epic={epic as CardRow}
        workspaceId={workspaceId}
        childCount={children.length}
        doneCount={doneCount}
      />
      {isEmpty ? (
        <div
          className="rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-16 text-center space-y-2"
          data-testid="epic-empty"
        >
          <p className="mono-meta-sm text-fg-faint">NO CARDS YET</p>
          <p className="text-sm text-fg-muted max-w-sm mx-auto">
            Create cards on the board with this epic as parent. They will
            appear here grouped by status.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveCardId(null)}
        >
          <div
            className="flex gap-4 overflow-x-auto pb-4"
            data-testid="epic-kanban-board"
          >
            {STATUS_ORDER.map((sk) => (
              <EpicStatusColumn
                key={sk}
                statusKind={sk}
                cards={buckets[sk]}
                boardId={epic.boardId}
                workspaceId={workspaceId}
              />
            ))}
            {buckets.unmapped.length > 0 && (
              <EpicStatusColumn
                statusKind="unmapped"
                cards={buckets.unmapped}
                boardId={epic.boardId}
                workspaceId={workspaceId}
              />
            )}
          </div>
          <DragOverlay
            dropAnimation={{
              duration: 220,
              easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {activeCard ? (
              <div className="w-72 rotate-2 scale-[1.02]">
                <CardTile
                  card={activeCard}
                  boardId={epic.boardId}
                  workspaceId={workspaceId}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
