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

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `list-drop:${list.id}`,
    data: { type: "list-drop", listId: list.id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 200ms cubic-bezier(0.2, 0, 0, 1)",
    opacity: isDragging ? 0.6 : 1,
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
      data-dragging={isDragging ? "true" : undefined}
      className="group/list flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-black/35 p-2 backdrop-blur-sm shadow-sm ring-1 ring-white/10 transition-all duration-200 ease-out hover:ring-white/20 data-[dragging=true]:rotate-[1deg] data-[dragging=true]:shadow-2xl"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab select-none rounded-md px-1.5 py-1 text-sm font-semibold tracking-tight text-white transition-colors duration-150 hover:bg-white/5 active:cursor-grabbing"
      >
        {list.title}
      </div>
      <div
        ref={setDropRef}
        data-over={isOver ? "true" : undefined}
        className="flex max-h-[calc(100vh-14rem)] flex-col gap-1.5 overflow-y-auto rounded-md p-0.5 transition-colors duration-150 data-[over=true]:bg-white/10"
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
