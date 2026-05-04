"use client";
import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { groupChildrenByStatus } from "@/lib/epic/group-children-by-status";
import type { StatusKind } from "@/lib/status";
import { EpicStatusColumn } from "./epic-status-column";
import { EpicHeader } from "./epic-header";
import { moveCardToStatus } from "@/actions/cards";
import type { CardRow } from "@/lib/queries/board-snapshot";

// Plan #epic-as-kanban — orchestrates the 5 status columns plus an
// optional Unmapped column for an epic's direct children. Drag-end calls
// the `moveCardToStatus` server action; on failure we roll back the
// optimistic listId patch on the board store. Realtime CDC reconciles
// position/listId on success.

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
  const [pendingError, setPendingError] = useState<string | null>(null);

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

  const onDragEnd = async (e: DragEndEvent) => {
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
      setPendingError(err instanceof Error ? err.message : "Move failed");
      updateCard(card.id, { listId: previousListId });
    }
  };

  if (!epic) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 text-fg-faint">
        Epic not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6 px-6 py-8">
      <EpicHeader
        epic={epic as CardRow}
        workspaceId={workspaceId}
        childCount={children.length}
        doneCount={doneCount}
      />
      {pendingError && (
        <div
          role="alert"
          className="chip mono-meta-sm text-[color:var(--status-blocked)]"
        >
          {pendingError}
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
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
      </DndContext>
    </div>
  );
}
