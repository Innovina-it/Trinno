"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type React from "react";
import { ChevronLeft, ChevronRight, ExternalLink, MousePointerClick } from "lucide-react";
import { useRouter } from "next/navigation";
import type { RoadmapCard } from "@/lib/queries/roadmap";

const TYPE_DOT: Record<string, string> = {
  epic: "bg-fg",
  story: "bg-fg/70",
  task: "bg-fg/40",
  subtask: "bg-fg/40",
  bug: "bg-fg/70",
};

type ContextMenu = { x: number; y: number };

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
  const router = useRouter();
  const dot = TYPE_DOT[card.type] ?? "bg-fg/40";
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the context menu on any outside mousedown.
  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  const menuStyle: CSSProperties | undefined = menu
    ? { position: "fixed", top: menu.y, left: menu.x, zIndex: 100 }
    : undefined;

  return (
    <>
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
        onPointerDown={(e) => {
          // Don't begin a drag from a right-button (context-menu) press.
          if (e.button !== 0) return;
          // Prevent accidental text selection during drag.
          e.preventDefault();
          onMoveStart(e, card.id);
        }}
        onDoubleClick={() => onOpen?.(card.id, card.boardId)}
        onContextMenu={handleContextMenu}
        data-card-id={card.id}
        data-roadmap-focus={card.id}
        data-testid="roadmap-bar"
        aria-label={`Roadmap bar for ${card.title}`}
        title={`${card.title} — ${card.startDate.toISOString().slice(0, 10)} → ${card.targetDate.toISOString().slice(0, 10)}`}
      >
        {/* Wider hit-zone (12px) for the left edge resize handle, with a hover-only chevron. */}
        <span
          className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 rounded-l-md flex items-center justify-center"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onResizeLeftStart(e, card.id);
          }}
          aria-hidden
        >
          <span className="absolute inset-y-0 left-0 w-1.5 bg-fg/40 rounded-l-md" />
          <ChevronLeft className="size-3 text-fg/80 relative" />
        </span>
        <span
          className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize opacity-0 group-hover/bar:opacity-100 rounded-r-md flex items-center justify-center"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onResizeRightStart(e, card.id);
          }}
          aria-hidden
        >
          <span className="absolute inset-y-0 right-0 w-1.5 bg-fg/40 rounded-r-md" />
          <ChevronRight className="size-3 text-fg/80 relative" />
        </span>
        <span
          aria-hidden
          className={`mr-1.5 inline-block size-1.5 rounded-full ${dot}`}
        />
        <span className="text-xs text-fg truncate">{card.title}</span>
      </div>
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          data-testid="roadmap-bar-menu"
          style={menuStyle}
          className="min-w-44 rounded-md border border-hairline bg-[color:var(--surface-strong)] shadow-lg backdrop-blur-md py-1 text-sm"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              router.push(`/b/${card.boardId}/c/${card.id}`);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-fg hover:bg-[rgb(255_255_255/0.06)]"
            data-testid="roadmap-bar-menu-open-board"
          >
            <ExternalLink className="size-3" />
            Open in board
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              onOpen?.(card.id, card.boardId);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-fg hover:bg-[rgb(255_255_255/0.06)]"
            data-testid="roadmap-bar-menu-view-card"
          >
            <MousePointerClick className="size-3" />
            View card
          </button>
        </div>
      )}
    </>
  );
}
