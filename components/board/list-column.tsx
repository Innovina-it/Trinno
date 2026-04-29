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
import { roman } from "@/lib/format";

export function ListColumn({
  list,
  boardId,
  ordinal,
}: {
  list: ListRow;
  boardId: string;
  ordinal?: number;
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

  const numeral = ordinal ? roman(ordinal) : "—";
  const cardLabel = `${listCards.length} CARD${listCards.length === 1 ? "" : "S"}`;
  // Compose the editorial column meta line into a single attribute so it can
  // render via a CSS pseudo-element. This keeps marginalia visible without
  // polluting the list column's textContent (drag tests rely on filtering
  // `[data-list-id]` by hasText: <title>).
  const listMeta = `${numeral} · ${cardLabel}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-list-id={list.id}
      data-dragging={isDragging ? "true" : undefined}
      className="group/list flex w-72 shrink-0 flex-col border border-ink bg-paper transition-shadow duration-200 ease-out data-[dragging=true]:rotate-[1deg] data-[dragging=true]:shadow-lg"
    >
      {/* Column heading: ordinal+count meta in mono, serif italic title beneath */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab select-none border-b border-rule px-3 py-2.5 active:cursor-grabbing"
      >
        <span
          aria-hidden
          className="list-ordinal-stamp block leading-none"
          data-list-ordinal={listMeta}
        />
        <h3 className="serif-display text-xl text-ink mt-1 leading-tight">
          {list.title}
        </h3>
      </div>

      <div
        ref={setDropRef}
        data-over={isOver ? "true" : undefined}
        className="flex max-h-[calc(100vh-18rem)] flex-col gap-2 overflow-y-auto p-2 transition-colors duration-150 data-[over=true]:bg-paper-shadow"
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
      <div className="border-t border-rule px-2 py-1.5">
        <AddCardForm listId={list.id} />
      </div>
    </div>
  );
}
