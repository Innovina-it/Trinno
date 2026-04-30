"use client";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CornerLeftUp } from "lucide-react";
import type { CardRow } from "@/lib/queries/board-snapshot";
import { useBoardStore } from "@/stores/board-store";
import { LabelStripes } from "./card/label-stripes";
import { DuePill } from "./card/due-pill";
import { TileIndicators } from "./card/tile-indicators";
import { TypeIcon } from "./card/type-picker";
import { BlockedBadge } from "./card/blocked-badge";
import { StoryPointsChip } from "./card/story-points-chip";
import { TimeChip } from "./card/time-chip";
import { cardCode } from "@/lib/format";

export function CardTile({
  card,
  boardId,
}: {
  card: CardRow;
  boardId: string;
}) {
  const sortableId = `card:${card.id}`;
  const parentCard = useBoardStore((s) =>
    card.parentCardId ? s.cards.find((c) => c.id === card.parentCardId) : null,
  );
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
      ? "0 0 0 1px rgb(255 255 255 / 0.55), 0 24px 50px -12px rgb(0 0 0 / 0.7), 0 0 0 4px rgb(255 255 255 / 0.10)"
      : undefined,
    // Lift dragged tile above siblings so it's never visually buried.
    zIndex: isDragging ? 50 : undefined,
  };

  // Suppress Link navigation if a drag actually occurred (browser still fires
  // click after a tiny move below the activation threshold otherwise).
  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <Link
      ref={setNodeRef}
      href={`/b/${boardId}/c/${card.id}`}
      scroll={false}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      data-card-id={card.id}
      data-dragging={isDragging ? "true" : undefined}
      className="group/card relative block rounded-xl bg-[color:var(--surface-strong)] backdrop-blur-md border border-[color:var(--hairline)] text-fg cursor-grab transition-all duration-200 ease-out shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset,0_8px_20px_-12px_rgb(0_0_0_/_0.5)] hover:-translate-y-0.5 hover:border-[color:var(--hairline-hi)] hover:bg-[color:var(--surface-hi)] hover:shadow-[0_1px_0_0_rgb(255_255_255/0.10)_inset,0_12px_28px_-12px_rgb(0_0_0/0.6)] active:cursor-grabbing data-[dragging=true]:rotate-[2deg] data-[dragging=true]:scale-[1.02] data-[dragging=true]:cursor-grabbing"
    >
      {/* Label stripes — top */}
      <LabelStripes cardId={card.id} />

      {/* Top metadata row: type icon + card ID via pseudo-element */}
      <div className="flex items-center justify-between px-3 pt-2">
        <div className="flex items-center gap-1.5">
          <TypeIcon type={card.type ?? "task"} className="size-3 text-fg-faint" />
          <BlockedBadge cardId={card.id} />
          <StoryPointsChip cardId={card.id} />
          <TimeChip cardId={card.id} />
        </div>
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
        {card.parentCardId && (
          <span
            className="mt-1 inline-flex items-center gap-1 mono-meta-sm text-fg-faint max-w-full"
            data-testid="tile-parent-breadcrumb"
            title={parentCard?.title ?? `#${cardCode(card.parentCardId)}`}
          >
            <CornerLeftUp className="size-3 shrink-0" />
            <span className="truncate max-w-[8rem]">
              {parentCard?.title ?? `#${cardCode(card.parentCardId)}`}
            </span>
          </span>
        )}
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
