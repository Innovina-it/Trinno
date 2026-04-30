"use client";
import type React from "react";
import type { RoadmapCard } from "@/lib/queries/roadmap";

const TYPE_DOT: Record<string, string> = {
  epic: "bg-fg",
  story: "bg-fg/70",
  task: "bg-fg/40",
  subtask: "bg-fg/40",
  bug: "bg-fg/70",
};

export function RoadmapBar({
  card,
  x,
  width,
  row,
  isHeader = false,
  focused = false,
  onMoveStart,
  onResizeLeftStart,
  onResizeRightStart,
  onOpen,
}: {
  card: RoadmapCard;
  x: number;
  width: number;
  row: number;
  isHeader?: boolean;
  focused?: boolean;
  onMoveStart: (e: React.PointerEvent, cardId: string) => void;
  onResizeLeftStart: (e: React.PointerEvent, cardId: string) => void;
  onResizeRightStart: (e: React.PointerEvent, cardId: string) => void;
  onOpen?: (cardId: string, boardId: string) => void;
}) {
  const dot = TYPE_DOT[card.type] ?? "bg-fg/40";
  return (
    <div
      style={{
        left: x,
        width: Math.max(width, 12),
        top: row * 36 + 4,
      }}
      className={`absolute h-7 rounded-md border border-fg/30 backdrop-blur-sm
                 hover:border-fg/60 transition-colors cursor-grab active:cursor-grabbing
                 flex items-center px-2 select-none group/bar
                 ${isHeader ? "bg-fg/15" : "bg-fg/8"}
                 ${focused ? "ring-2 ring-fg/50" : ""}`}
      onPointerDown={(e) => onMoveStart(e, card.id)}
      onDoubleClick={() => onOpen?.(card.id, card.boardId)}
      data-card-id={card.id}
      data-roadmap-focus={card.id}
      data-testid="roadmap-bar"
      aria-label={`Roadmap bar for ${card.title}`}
      title={`${card.title} — ${card.startDate.toISOString().slice(0, 10)} → ${card.targetDate.toISOString().slice(0, 10)}`}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-fg/40 rounded-l-md"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeLeftStart(e, card.id);
        }}
        aria-hidden
      />
      <span
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-fg/40 rounded-r-md"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeRightStart(e, card.id);
        }}
        aria-hidden
      />
      <span
        aria-hidden
        className={`mr-1.5 inline-block size-1.5 rounded-full ${dot}`}
      />
      <span className="text-xs text-fg truncate">{card.title}</span>
    </div>
  );
}
