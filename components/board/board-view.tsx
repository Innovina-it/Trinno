"use client";
import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useBoardStore } from "@/stores/board-store";
import type { BoardRow } from "@/lib/queries/board-snapshot";
import { positionBetween } from "@/lib/ordering";
import { moveCard as moveCardAction } from "@/actions/cards";
import { moveList as moveListAction } from "@/actions/lists";
import { Button } from "@/components/ui/button";
import { ListColumn } from "./list-column";
import { AddListForm } from "./add-list-form";

function decodeId(
  sortableId: string,
): { type: "list" | "card"; id: string } | null {
  const idx = sortableId.indexOf(":");
  if (idx < 0) return null;
  const prefix = sortableId.slice(0, idx);
  const id = sortableId.slice(idx + 1);
  if (prefix === "list") return { type: "list", id };
  if (prefix === "card") return { type: "card", id };
  return null;
}

export function BoardView({ board }: { board: BoardRow }) {
  const router = useRouter();
  const lists = useBoardStore((s) => s.lists);
  const cards = useBoardStore((s) => s.cards);
  const moveListLocal = useBoardStore((s) => s.moveList);
  const moveCardLocal = useBoardStore((s) => s.moveCard);
  const [, start] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const listSortableIds = useMemo(
    () => lists.map((l) => `list:${l.id}`),
    [lists],
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const activeKey = decodeId(String(active.id));
    if (!activeKey) return;

    if (activeKey.type === "list") {
      const overKey = decodeId(String(over.id));
      if (!overKey || overKey.type !== "list") return;

      const fromIdx = lists.findIndex((l) => l.id === activeKey.id);
      const toIdx = lists.findIndex((l) => l.id === overKey.id);
      if (fromIdx < 0 || toIdx < 0) return;

      const reordered = arrayMove(lists, fromIdx, toIdx);
      const before = toIdx > 0 ? reordered[toIdx - 1].position : null;
      const after =
        toIdx < reordered.length - 1 ? reordered[toIdx + 1].position : null;
      const newPos = positionBetween(before, after);

      moveListLocal(activeKey.id, newPos);
      start(async () => {
        try {
          await moveListAction({ id: activeKey.id, position: newPos });
        } catch (err) {
          toast.error("Failed to move list: " + (err as Error).message);
          router.refresh();
        }
      });
      return;
    }

    if (activeKey.type === "card") {
      const overKey = decodeId(String(over.id));
      const overData = over.data.current as
        | { type?: string; listId?: string }
        | undefined;

      const sourceCard = cards.find((c) => c.id === activeKey.id);
      if (!sourceCard) return;

      let toListId: string | null = null;
      let prevPos: string | null = null;
      let nextPos: string | null = null;

      if (overKey?.type === "card") {
        const targetCard = cards.find((c) => c.id === overKey.id);
        if (!targetCard) return;
        toListId = targetCard.listId;
        const targetListCards = cards.filter(
          (c) => c.listId === toListId && c.id !== activeKey.id,
        );
        let dropIndex = targetListCards.findIndex((c) => c.id === overKey.id);
        if (dropIndex < 0) dropIndex = targetListCards.length;
        prevPos =
          dropIndex > 0 ? targetListCards[dropIndex - 1].position : null;
        nextPos =
          dropIndex < targetListCards.length
            ? targetListCards[dropIndex].position
            : null;
      } else if (overData?.type === "list-drop" || overData?.type === "list") {
        toListId = overData.listId ?? null;
        if (!toListId) return;
        const targetListCards = cards.filter(
          (c) => c.listId === toListId && c.id !== activeKey.id,
        );
        prevPos =
          targetListCards.length > 0
            ? targetListCards[targetListCards.length - 1].position
            : null;
        nextPos = null;
      } else {
        return;
      }

      if (!toListId) return;
      const newPos = positionBetween(prevPos, nextPos);
      const targetListId = toListId;
      moveCardLocal(activeKey.id, targetListId, newPos);
      start(async () => {
        try {
          await moveCardAction({
            id: activeKey.id,
            listId: targetListId,
            position: newPos,
          });
        } catch (err) {
          toast.error("Failed to move card: " + (err as Error).message);
          router.refresh();
        }
      });
    }
  }

  const bg =
    board.backgroundKind === "color" ? board.backgroundValue : "#0079bf";

  return (
    <div
      className="-m-6 min-h-[calc(100vh-3rem)] p-4"
      style={{ background: bg }}
    >
      <div className="mb-4 flex items-center justify-between px-2">
        <h1 className="text-xl font-semibold text-white">{board.title}</h1>
        <Button
          render={<Link href={`/b/${board.id}/settings`} />}
          nativeButton={false}
          variant="secondary"
          size="sm"
        >
          Board settings
        </Button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-start gap-3 overflow-x-auto px-2 pb-4">
          <SortableContext
            items={listSortableIds}
            strategy={horizontalListSortingStrategy}
          >
            {lists.map((list) => (
              <ListColumn key={list.id} list={list} boardId={board.id} />
            ))}
          </SortableContext>
          <AddListForm boardId={board.id} />
        </div>
      </DndContext>
    </div>
  );
}
