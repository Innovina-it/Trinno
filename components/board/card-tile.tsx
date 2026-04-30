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
    transition: transition ?? "transform 200ms cubic-bezier(0.2, 0, 0, 1)",
    opacity: isDragging ? 0.55 : 1,
    boxShadow: isDragging
      ? "0 0 0 1px rgb(255 43 214 / 0.6), 0 24px 50px -12px rgb(255 43 214 / 0.55), 0 0 0 4px rgb(255 43 214 / 0.18)"
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
      className="group/card relative block rounded-xl bg-[color:var(--surface-strong)] backdrop-blur-md border border-[color:var(--hairline)] text-fg cursor-grab transition-all duration-200 ease-out shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset,0_8px_20px_-12px_rgb(0_0_0_/_0.5)] hover:-translate-y-0.5 hover:border-[color:var(--hairline-hi)] hover:bg-[color:var(--surface-hi)] hover:shadow-[0_1px_0_0_rgb(255_255_255/0.10)_inset,0_18px_36px_-12px_rgb(0_229_255/0.25),0_0_0_1px_rgb(0_229_255/0.18)] active:cursor-grabbing data-[dragging=true]:rotate-[2deg] data-[dragging=true]:scale-[1.02] data-[dragging=true]:cursor-grabbing"
    >
      {/* Label stripes — top */}
      <LabelStripes cardId={card.id} />

      {/* Top metadata row: card ID via pseudo-element to keep textContent clean */}
      <div className="flex justify-end px-3 pt-2">
        <span
          aria-hidden
          className="card-code-stamp leading-none"
          data-card-code={cardCode(card.id)}
        />
      </div>

      {/* Title — Geist sans, gradient underline grows on hover */}
      <div className="px-3 pb-2.5 pt-1">
        <span className="block text-sm leading-snug">
          <span className="hover-underline-signal group-hover/card:hover-underline-signal-active inline">
            {card.title}
          </span>
        </span>
      </div>

      {card.dueDate && (
        <div className="px-3 pb-2.5">
          <DuePill card={card} />
        </div>
      )}

      <div className="px-3 pb-2.5">
        <TileIndicators cardId={card.id} />
      </div>
    </Link>
  );
}
