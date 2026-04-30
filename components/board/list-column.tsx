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

// Per-list accent — deterministic from list id, monochrome shades.
const ACCENT_PALETTE = [
  "rgb(250 250 250 / 0.85)",
  "rgb(250 250 250 / 0.55)",
  "rgb(250 250 250 / 0.35)",
  "rgb(250 250 250 / 0.70)",
  "rgb(250 250 250 / 0.45)",
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function ListColumn({
  list,
  boardId,
  ordinal,
  cardIdFilter,
}: {
  list: ListRow;
  boardId: string;
  ordinal?: number;
  cardIdFilter?: Set<string>;
}) {
  const cards = useBoardStore((s) => s.cards);
  const listCards = useMemo(
    () => cards.filter((c) => c.listId === list.id),
    [cards, list.id],
  );
  const filtered = useMemo(
    () => (cardIdFilter ? listCards.filter((c) => cardIdFilter.has(c.id)) : listCards),
    [listCards, cardIdFilter],
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

  const accent = ACCENT_PALETTE[hashId(list.id) % ACCENT_PALETTE.length];

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? "transform 220ms cubic-bezier(0.2, 0, 0, 1)",
    opacity: isDragging ? 0.6 : 1,
  };

  const cardSortableIds = useMemo(
    () => filtered.map((c) => `card:${c.id}`),
    [filtered],
  );

  const numeral = ordinal ? roman(ordinal) : "—";
  const cardLabel = `${filtered.length} CARD${filtered.length === 1 ? "" : "S"}`;
  const listMeta = `${numeral} · ${cardLabel}`;
  const overLimit = list.wipLimit != null && filtered.length > list.wipLimit;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-list-id={list.id}
      data-dragging={isDragging ? "true" : undefined}
      className="group/list relative flex w-80 shrink-0 flex-col rounded-2xl glass overflow-hidden transition-all duration-300 ease-out data-[dragging=true]:rotate-[2deg] data-[dragging=true]:scale-[1.02]"
    >
      {/* Per-list accent strip — vertical bar on the left edge, fades top-to-bottom */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px]"
        style={{
          background: `linear-gradient(180deg, ${accent} 0%, transparent 100%)`,
        }}
      />

      {/* Column heading: ordinal+count meta in chip, serif italic title */}
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab select-none border-b border-hairline px-4 py-3 active:cursor-grabbing"
      >
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="list-ordinal-stamp block leading-none"
            data-list-ordinal={listMeta}
          />
          <span
            data-testid="list-wip-chip"
            className={`chip tabular-nums ${overLimit ? "bg-red-900/40 text-red-200 ring-1 ring-red-500/30" : ""}`}
          >
            {filtered.length}{list.wipLimit != null ? `/${list.wipLimit}` : ""}
          </span>
        </div>
        <h3
          className="serif-display text-2xl text-fg mt-1.5 leading-tight transition-all duration-200 group-hover/list:gradient-text-static"
          style={{ ['--accent' as string]: accent } as React.CSSProperties}
        >
          {list.title}
        </h3>
      </div>

      <div
        ref={setDropRef}
        data-over={isOver ? "true" : undefined}
        className="flex max-h-[calc(100vh-22rem)] flex-col gap-2.5 overflow-y-auto p-2.5 transition-colors duration-200 data-[over=true]:bg-[color:var(--surface-strong)]"
      >
        <SortableContext
          items={cardSortableIds}
          strategy={verticalListSortingStrategy}
        >
          {filtered.map((card) => (
            <CardTile key={card.id} card={card} boardId={boardId} />
          ))}
        </SortableContext>
      </div>
      <div className="border-t border-hairline px-2.5 py-2">
        <AddCardForm listId={list.id} />
      </div>
    </div>
  );
}
