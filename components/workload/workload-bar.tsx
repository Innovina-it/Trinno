"use client";
import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format-date";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calendar, X, ExternalLink } from "lucide-react";
import { updateCard } from "@/actions/cards";
import type { WorkloadCard } from "@/lib/queries/workload";
import type { DragMode } from "@/lib/workload/drag";

const STATUS_FILL: Record<string, string> = {
  todo: "color-mix(in oklab, var(--status-todo) 30%, var(--surface-strong))",
  in_progress:
    "color-mix(in oklab, var(--status-in-progress) 30%, var(--surface-strong))",
  review: "color-mix(in oklab, var(--status-review) 30%, var(--surface-strong))",
  done: "color-mix(in oklab, var(--status-done) 25%, var(--surface-strong))",
  blocked:
    "color-mix(in oklab, var(--status-blocked) 35%, var(--surface-strong))",
};

const PRIORITY_STRIPE: Record<string, string> = {
  p0: "var(--status-blocked)",
  p1: "var(--status-in-progress)",
  p2: "var(--status-review)",
  p3: "var(--hairline-hi)",
  p4: "var(--hairline)",
};

function spanDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

const RESIZE_ZONE_PX = 6;
// Width below which we hide the resize zones — bars smaller than this
// would dedicate their entire surface to resize hit-zones, leaving no
// "move" area to grab. ~3x the zone width keeps a usable middle.
const MIN_BAR_WIDTH_FOR_RESIZE = RESIZE_ZONE_PX * 3 + 4;

export function WorkloadBar({
  card,
  x,
  width,
  top,
  height,
  // Optional drag wiring. Omitted when the lane is read-only or the
  // card is in a state that disallows drag (completed).
  onBeginDrag,
  // True while THIS bar is the one being dragged — drives cursor +
  // raised z-index for the active bar.
  isDraggingActive,
  // True while ANY drag is in flight — used to suppress the <Link>
  // click on pointerup for the dragged bar without disturbing other
  // bars' tooltip state.
  isAnyDragInFlight,
}: {
  card: WorkloadCard;
  x: number;
  width: number;
  top: number;
  height: number;
  onBeginDrag?: (mode: DragMode, e: React.PointerEvent) => void;
  isDraggingActive?: boolean;
  isAnyDragInFlight?: boolean;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<{ x: number; y: number } | null>(
    null,
  );
  const router = useRouter();
  const [, startTransition] = useTransition();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOwner = card.role === "owner";
  const fill =
    (card.statusKind && STATUS_FILL[card.statusKind]) ??
    "var(--surface-hi)";
  const priorityStripe =
    card.priority && (card.priority === "p0" || card.priority === "p1")
      ? PRIORITY_STRIPE[card.priority]
      : null;

  function onEnter() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setTooltipOpen(true), 350);
  }
  function onLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setTooltipOpen(false);
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuOpen({ x: e.clientX, y: e.clientY });
    setTooltipOpen(false);
  }

  // Close menu on outside click / Esc.
  useEffect(() => {
    if (!menuOpen) return;
    function close() { setMenuOpen(null); }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const days = spanDays(card.startDate, card.targetDate);
  const isCompleted = card.completedAt != null;
  const dragEnabled = !!onBeginDrag && !isCompleted;
  const showResizeZones = dragEnabled && width >= MIN_BAR_WIDTH_FOR_RESIZE;

  // pointerdown on the bar body / edges. Each branch routes to the
  // matching drag mode. `data-readonly` mirrors the absence of
  // `onBeginDrag` so tests + downstream styling can read it.
  function onPointerDownBody(e: React.PointerEvent) {
    if (!dragEnabled) {
      if (isCompleted) {
        // Soft cue rather than a blocking dialog. The bar is still a
        // <Link> so right-click and click-through still work.
        toast.info("Card is complete");
      }
      return;
    }
    onBeginDrag!("move", e);
  }
  function onPointerDownLeft(e: React.PointerEvent) {
    if (!dragEnabled) return;
    onBeginDrag!("resize-left", e);
  }
  function onPointerDownRight(e: React.PointerEvent) {
    if (!dragEnabled) return;
    onBeginDrag!("resize-right", e);
  }

  // Suppress navigation if the user just finished a drag. The pointerup
  // -> click sequence still fires after our drag listeners run, so we
  // gate Link activation behind the hook's isDragging flag.
  function onClickLink(e: React.MouseEvent) {
    if (isAnyDragInFlight) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // Keyboard nudge — Arrow keys shift the bar's date span by ±1 day,
  // Shift+Arrow shifts by ±7 days. Persists directly via updateCard
  // (single discrete event — no optimistic Map needed, the realtime
  // echo will refresh the bar). Skips on completed cards, mirroring
  // the drag harness's gate.
  function onKeyDownBar(e: React.KeyboardEvent) {
    if (!dragEnabled) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const days = e.shiftKey ? 7 : 1;
    const sign = e.key === "ArrowLeft" ? -1 : 1;
    const deltaMs = sign * days * 86_400_000;
    const nextStart = new Date(card.startDate.getTime() + deltaMs);
    const nextTarget = new Date(card.targetDate.getTime() + deltaMs);
    const cardId = card.id;
    startTransition(() => {
      void (async () => {
        try {
          await updateCard({
            id: cardId,
            startDate: nextStart.toISOString(),
            targetDate: nextTarget.toISOString(),
          });
        } catch (err) {
          toast.error((err as Error).message ?? "Failed to update dates");
        }
      })();
    });
  }

  const cursor = !dragEnabled
    ? "cursor-pointer"
    : isDraggingActive
      ? "cursor-grabbing"
      : "cursor-grab";

  return (
    <>
      <Link
        href={`/b/${card.boardId}/c/${card.id}`}
        scroll={false}
        tabIndex={0}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDownBody}
        onClick={onClickLink}
        onKeyDown={onKeyDownBar}
        data-testid="workload-bar"
        data-card-id={card.id}
        data-role={card.role}
        data-completed={isCompleted ? "true" : "false"}
        data-readonly={!dragEnabled ? "true" : "false"}
        data-dragging={isDraggingActive ? "true" : "false"}
        className={`absolute rounded-md text-xs leading-none flex items-center overflow-hidden whitespace-nowrap text-fg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${cursor} ${isCompleted ? "opacity-55 saturate-50" : ""}`}
        style={{
          left: x,
          top,
          width,
          height,
          background: isOwner ? fill : "transparent",
          border: `1px solid ${isOwner ? "var(--hairline-hi)" : "color-mix(in oklab, " + fill + " 80%, var(--hairline-hi))"}`,
          boxShadow: isOwner
            ? "inset 0 1px 0 0 rgb(255 255 255 / 0.06)"
            : "none",
          // Active dragged bar floats above siblings + today line so
          // it visually leads the move.
          zIndex: isDraggingActive ? 25 : undefined,
          // Subtle scale lift while dragging so it feels picked-up.
          transform: isDraggingActive ? "translateY(-1px)" : undefined,
          // Stop the browser from claiming horizontal touch swipes for
          // native scroll on this bar — we want pointermove (touch +
          // pen) to drive the drag. The surrounding scroller keeps
          // touch-action: auto so swipes outside bars still scroll.
          touchAction: "none",
        }}
      >
        {priorityStripe && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0"
            style={{ width: 3, background: priorityStripe }}
          />
        )}
        <span
          className={`px-2 truncate ${isCompleted ? "line-through" : ""}`}
          style={{ paddingLeft: priorityStripe ? 8 : undefined }}
        >
          {card.title}
        </span>
        {/* Resize hit-zones — only rendered when there's enough bar
            width to fit them without swallowing the move zone. The
            zones sit on top of the link surface and stop the
            pointerdown propagating so the body's "move" handler
            doesn't fire for the same gesture. */}
        {showResizeZones && (
          <>
            <span
              aria-hidden
              data-testid="workload-bar-resize-left"
              onPointerDown={onPointerDownLeft}
              className="absolute inset-y-0 left-0 cursor-ew-resize"
              style={{ width: RESIZE_ZONE_PX, touchAction: "none" }}
            />
            <span
              aria-hidden
              data-testid="workload-bar-resize-right"
              onPointerDown={onPointerDownRight}
              className="absolute inset-y-0 right-0 cursor-ew-resize"
              style={{ width: RESIZE_ZONE_PX, touchAction: "none" }}
            />
          </>
        )}
      </Link>

      {tooltipOpen && !isDraggingActive && (
        <div
          role="tooltip"
          className="absolute z-30 pointer-events-none rounded-lg border border-hairline-hi bg-[color:var(--popover)] px-3 py-2 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.7)]"
          style={{
            left: x,
            top: top + height + 6,
            minWidth: 240,
            maxWidth: 320,
          }}
        >
          <p className="text-sm font-medium text-fg leading-snug">
            {card.title}
          </p>
          <p className="mono-meta-sm text-fg-muted mt-1 tabular-nums">
            {formatDate(card.startDate)} → {formatDate(card.targetDate)} ·{" "}
            {days < 7 ? `${days}d` : `${Math.round(days / 7)}w`}
          </p>
          <p className="mono-meta-sm text-fg-faint mt-1.5 truncate">
            {card.workspaceName} / {card.boardTitle}
            {card.sprintName ? ` · ${card.sprintName}` : ""}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`mono-meta-sm px-1.5 py-px rounded ${
                isOwner
                  ? "bg-[color:var(--surface-hi)] text-fg"
                  : "border border-hairline-hi text-fg-muted"
              }`}
            >
              {isOwner ? "OWNER" : "COLLAB"}
            </span>
            {card.priority && (
              <span className="mono-meta-sm text-fg-faint">
                {card.priority.toUpperCase()}
              </span>
            )}
          </div>
        </div>
      )}

      {menuOpen && (
        <div
          role="menu"
          aria-label="Card actions"
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-44 rounded-lg border border-hairline-hi bg-[color:var(--popover)] py-1 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.7)]"
          style={{ left: menuOpen.x, top: menuOpen.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(null);
              router.push(`/b/${card.boardId}/c/${card.id}`);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]"
          >
            <ExternalLink className="size-3.5" /> Open card
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(null);
              router.push(`/b/${card.boardId}/c/${card.id}#dates`);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]"
          >
            <Calendar className="size-3.5" /> Edit dates
          </button>
          <div className="my-1 h-px bg-hairline" />
          <button
            type="button"
            role="menuitem"
            onClick={() => setMenuOpen(null)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]"
          >
            <X className="size-3.5" /> Close
          </button>
        </div>
      )}
    </>
  );
}
