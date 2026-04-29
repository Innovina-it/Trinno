"use client";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { LabelStripes } from "./card/label-stripes";
import { DuePill } from "./card/due-pill";
import { TileIndicators } from "./card/tile-indicators";

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
    transition: transition ?? "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging
      ? "0 14px 28px rgba(0,0,0,0.18), 0 6px 10px rgba(0,0,0,0.12)"
      : undefined,
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
      data-dragging={isDragging ? "true" : undefined}
      className="group/card relative block rounded-md bg-white p-2 text-sm text-foreground shadow-sm ring-1 ring-black/5 cursor-grab transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/30 active:cursor-grabbing data-[dragging=true]:rotate-[1.5deg] data-[dragging=true]:scale-[1.02] data-[dragging=true]:cursor-grabbing data-[dragging=true]:shadow-lg"
    >
      <LabelStripes cardId={card.id} />
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 leading-snug">{card.title}</span>
      </div>
      {card.dueDate && (
        <div className="mt-1.5">
          <DuePill card={card} />
        </div>
      )}
      <TileIndicators cardId={card.id} />
    </Link>
  );
}
