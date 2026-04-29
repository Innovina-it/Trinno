"use client";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { LabelStripes } from "./card/label-stripes";
import { DuePill } from "./card/due-pill";

export function CardTile({
  card,
  boardId,
}: {
  card: CardRow;
  boardId: string;
}) {
  const sortableId = `card:${card.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: sortableId,
      data: { type: "card", cardId: card.id, listId: card.listId },
    });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <Link
      ref={setNodeRef}
      href={`/b/${boardId}/c/${card.id}`}
      scroll={false}
      style={style}
      {...attributes}
      {...listeners}
      data-card-id={card.id}
      className="block rounded bg-white p-2 text-sm text-foreground shadow-sm cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-primary/40"
    >
      <LabelStripes cardId={card.id} />
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1">{card.title}</span>
      </div>
      {card.dueDate && (
        <div className="mt-1">
          <DuePill card={card} />
        </div>
      )}
    </Link>
  );
}
