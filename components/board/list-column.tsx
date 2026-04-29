"use client";
import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ListRow } from "@/lib/queries/board-snapshot";
import { useBoardStore } from "@/stores/board-store";
import { CardTile } from "./card-tile";
import { AddCardForm } from "./add-card-form";

export function ListColumn({
  list,
  boardId,
}: {
  list: ListRow;
  boardId: string;
}) {
  const cards = useBoardStore((s) => s.cards);
  const listCards = useMemo(
    () => cards.filter((c) => c.listId === list.id),
    [cards, list.id],
  );

  const sortableId = `list:${list.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: sortableId,
      data: { type: "list", listId: list.id },
    });

  const { setNodeRef: setDropRef } = useDroppable({
    id: `list-drop:${list.id}`,
    data: { type: "list-drop", listId: list.id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const cardSortableIds = useMemo(
    () => listCards.map((c) => `card:${c.id}`),
    [listCards],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-list-id={list.id}
      className="flex w-72 shrink-0 flex-col gap-2 rounded-md bg-black/40 p-2"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab px-1 text-sm font-medium text-white active:cursor-grabbing"
      >
        {list.title}
      </div>
      <div
        ref={setDropRef}
        className="flex max-h-[calc(100vh-14rem)] flex-col gap-1.5 overflow-y-auto"
      >
        <SortableContext
          items={cardSortableIds}
          strategy={verticalListSortingStrategy}
        >
          {listCards.map((card) => (
            <CardTile key={card.id} card={card} boardId={boardId} />
          ))}
        </SortableContext>
      </div>
      <AddCardForm listId={list.id} />
    </div>
  );
}
