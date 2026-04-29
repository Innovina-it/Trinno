"use client";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { LabelStripes } from "./card/label-stripes";
import { DuePill } from "./card/due-pill";
import { TileIndicators } from "./card/tile-indicators";
import { cardCode } from "@/lib/format";

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
      ? "0 14px 28px rgb(12 12 10 / 0.18)"
      : undefined,
    outline: isDragging ? "1px solid var(--signal)" : undefined,
    outlineOffset: isDragging ? "2px" : undefined,
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
      className="group/card relative block rounded-none border border-ink bg-paper text-ink shadow-sm cursor-grab transition-transform duration-150 ease-out hover:-translate-y-0.5 active:cursor-grabbing data-[dragging=true]:rotate-[1.5deg] data-[dragging=true]:cursor-grabbing"
    >
      {/* Label stripes — horizontal bars at top, no rounded corners */}
      <LabelStripes cardId={card.id} />

      {/* Top metadata row: card ID rendered as a CSS pseudo-element so it's
          visible but excluded from textContent (drag tests assert tile text
          == card title only). */}
      <div className="flex justify-end px-2.5 pt-1.5">
        <span
          aria-hidden
          className="card-code-stamp leading-none"
          data-card-code={cardCode(card.id)}
        />
      </div>

      {/* Title — Geist sans, with hairline signal-orange underline on hover */}
      <div className="px-2.5 pb-2 pt-1">
        <span className="block text-sm leading-snug">
          <span className="hover-underline-signal group-hover/card:hover-underline-signal-active inline">{card.title}</span>
        </span>
      </div>

      {card.dueDate && (
        <div className="px-2.5 pb-2">
          <DuePill card={card} />
        </div>
      )}

      <div className="px-2.5 pb-2">
        <TileIndicators cardId={card.id} />
      </div>
    </Link>
  );
}
