"use client";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow } from "@/lib/queries/board-snapshot";

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
      className="block rounded bg-white p-2 text-sm text-foreground shadow-sm cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-primary/40"
    >
      {card.title}
    </Link>
  );
}
