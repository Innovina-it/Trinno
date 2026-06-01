"use client";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type React from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RoadmapCard } from "@/lib/queries/roadmap";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { STATUS_LABEL, type StatusKind } from "@/lib/status";
import { archiveCard, setRoadmapCompletion, updateCard } from "@/actions/cards";
import { formatDate } from "@/lib/format-date";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";
import {
  CardContextMenu,
  type CardContextMenuPosition,
} from "@/components/board/card/card-context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";

export type RoadmapBarAssignee = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

// Stable swatch per user id for the initials fallback when avatarUrl is null.
// Mirrors components/board/assignee-picker.tsx so the same user gets the same
// colour everywhere.
const ASSIGNEE_SWATCHES = [
  "bg-emerald-500/30 text-emerald-100",
  "bg-violet-500/30 text-violet-100",
  "bg-amber-500/30 text-amber-100",
  "bg-rose-500/30 text-rose-100",
  "bg-sky-500/30 text-sky-100",
  "bg-fuchsia-500/30 text-fuchsia-100",
];

function swatchFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ASSIGNEE_SWATCHES[h % ASSIGNEE_SWATCHES.length];
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function BarAvatar({ member }: { member: RoadmapBarAssignee }) {
  const base =
    "inline-flex size-4 items-center justify-center rounded-full ring-1 ring-[color:var(--surface)] overflow-hidden text-[8px] font-medium leading-none";
  if (member.avatarUrl) {
    return (
      <span
        className={base}
        title={member.displayName}
        aria-label={member.displayName}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={member.avatarUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      </span>
    );
  }
  return (
    <span
      className={`${base} ${swatchFor(member.id)}`}
      title={member.displayName}
      aria-label={member.displayName}
    >
      {initials(member.displayName)}
    </span>
  );
}

const TYPE_DOT: Record<string, string> = {
  epic: "bg-fg",
  story: "bg-fg/70",
  task: "bg-fg/40",
  subtask: "bg-fg/40",
  bug: "bg-fg/70",
};

function statusFill(status: StatusKind | null, isHeader: boolean): {
  className: string;
  style: CSSProperties;
} {
  if (!status) {
    return {
      className: isHeader ? "bg-fg/15" : "bg-fg/8",
      style: {},
    };
  }
  switch (status) {
    case "todo":
      return {
        className: "",
        style: { background: "color-mix(in oklab, var(--status-todo) 22%, transparent)" },
      };
    case "in_progress":
      return {
        className: "ring-1 ring-inset animate-pulse",
        style: {
          background: "color-mix(in oklab, var(--status-in-progress) 38%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--status-in-progress) 55%, transparent)",
        },
      };
    case "review":
      return {
        className: "",
        style: {
          background: "color-mix(in oklab, var(--status-review) 22%, transparent)",
          backgroundImage:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--status-review) 45%, transparent) 0 4px, transparent 4px 8px)",
        },
      };
    case "done":
      return {
        className: "",
        style: {
          background: "color-mix(in oklab, var(--status-done) 22%, transparent)",
          backgroundImage:
            "repeating-linear-gradient(0deg, color-mix(in oklab, var(--status-done) 50%, transparent) 0 2px, transparent 2px 6px)",
        },
      };
    case "blocked":
      return {
        className: "ring-2 ring-inset",
        style: {
          background: isHeader
            ? "color-mix(in oklab, var(--status-blocked) 18%, transparent)"
            : "color-mix(in oklab, var(--status-blocked) 12%, transparent)",
          boxShadow: "inset 0 0 0 2px color-mix(in oklab, var(--status-blocked) 60%, transparent)",
        },
      };
  }
}

function isoForInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function dateToIso(d: Date | null): string {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

export function RoadmapBar({
  card,
  x,
  width,
  row,
  isHeader = false,
  focused = false,
  status = null,
  storyPoints = null,
  sprintName = null,
  assignees = [],
  availableSpaceRight = Number.POSITIVE_INFINITY,
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
  status?: StatusKind | null;
  storyPoints?: number | null;
  sprintName?: string | null;
  assignees?: RoadmapBarAssignee[];
  // Pixels of empty space between this bar's right edge and the next bar
  // (or canvas edge) in the same row. Used to suppress the assignee
  // overflow stack when it would collide with the next bar.
  availableSpaceRight?: number;
  onMoveStart: (e: React.PointerEvent, cardId: string) => void;
  onResizeLeftStart: (e: React.PointerEvent, cardId: string) => void;
  onResizeRightStart: (e: React.PointerEvent, cardId: string) => void;
  onOpen?: (cardId: string, boardId: string) => void;
}) {
  const router = useRouter();
  const patchCardLocal = useWorkspaceStore((s) => s.patchCard);
  const dot = TYPE_DOT[card.type] ?? "bg-fg/40";
  const [menu, setMenu] = useState<CardContextMenuPosition | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const [datesStart, setDatesStart] = useState(() => isoForInput(card.startDate));
  const [datesTarget, setDatesTarget] = useState(() => isoForInput(card.targetDate));
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [, startTransition] = useTransition();

  function scheduleTooltip() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => {
      // Capture viewport coords at open time so the portal-rendered
      // tooltip can be positioned with `position: fixed`, escaping the
      // roadmap grid's `overflow-hidden` clip. We don't track scroll —
      // mouseleave (which fires on scroll-induced pointer drift) hides
      // the tooltip anyway.
      if (barRef.current) {
        const r = barRef.current.getBoundingClientRect();
        setTooltipPos({ left: r.left + r.width / 2, top: r.bottom + 6 });
      }
      setTooltipOpen(true);
    }, 350);
  }
  function cancelTooltip() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = null;
    setTooltipOpen(false);
    setTooltipPos(null);
  }
  useEffect(() => {
    return () => {
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    };
  }, []);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function openMenuFromTrigger(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4 });
  }

  function handleOpenCard() {
    // Prefer the in-place quick-view (zero navigation, no loading flash).
    // The parent (roadmap-view) registers `onOpen` which remembers the
    // roadmap origin and opens CardQuickView as an overlay. Only fall
    // back to a route navigation if no handler is wired (legacy usage).
    if (onOpen) {
      onOpen(card.id, card.boardId);
      return;
    }
    router.push(`/b/${card.boardId}/c/${card.id}`);
  }

  function handleInBoard() {
    router.push(`/b/${card.boardId}`);
  }

  function handleEditDates() {
    setDatesStart(isoForInput(card.startDate));
    setDatesTarget(isoForInput(card.targetDate));
    setDatesOpen(true);
  }

  function handleArchive() {
    startTransition(async () => {
      try {
        await archiveCard({ id: card.id, archived: true });
        toast.success(`Archived "${card.title}"`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function handleToggleComplete() {
    const next = !isCompleted;
    // Optimistic patch to the workspace store so the bar flips
    // immediately. Realtime CDC will reconcile when the trigger emits
    // the canonical row. Without this, the bar stays in its pre-click
    // state until the round-trip completes — looks broken.
    patchCardLocal(card.id, {
      completedAt: next ? new Date() : null,
      dueComplete: next,
    });
    startTransition(async () => {
      try {
        await setRoadmapCompletion({ cardId: card.id, completed: next });
      } catch (err) {
        // Roll back optimistic patch.
        patchCardLocal(card.id, {
          completedAt: next ? null : new Date(),
          dueComplete: !next,
        });
        toast.error((err as Error).message);
      }
    });
  }

  // Plan #16b-γ-G G4 — keyboard parity for the gutter drag. Same items
  // are flat (no submenu) since the existing menu is a stack of plain
  // buttons. Includes a "Clear priority" entry when one is set.
  function handleSetPriority(next: CardPriority | null) {
    startTransition(async () => {
      try {
        await updateCard({ id: card.id, priority: next });
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function handleSaveDates() {
    if (!datesStart || !datesTarget) {
      toast.error("Both dates required");
      return;
    }
    if (datesStart > datesTarget) {
      toast.error("Start must be on or before target");
      return;
    }
    const startISO = new Date(`${datesStart}T00:00:00.000Z`).toISOString();
    const targetISO = new Date(`${datesTarget}T00:00:00.000Z`).toISOString();
    startTransition(async () => {
      try {
        await updateCard({
          id: card.id,
          startDate: startISO,
          targetDate: targetISO,
        });
        setDatesOpen(false);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  const fill = statusFill(status, isHeader);
  const statusLabel = status ? STATUS_LABEL[status] : null;
  // Plan #16b-γ-G G4 — bars are always tinted by priority (regardless of
  // whether the gutter is visible). 3px stripe at the bar's left edge.
  // Skipped when priority is null — preserves original visuals for
  // unset cards.
  const priority = card.priority ?? null;
  const priorityDot = priority ? PRIORITY_TINT[priority as CardPriority].dot : null;
  const isCompleted = card.completedAt != null;
  // A late, still-open task gets a red outline. targetDate is a calendar
  // day stored at midnight UTC (handleSaveDates), so the task is NOT overdue
  // for the whole of its target day — it flags only once the day after has
  // started. Unlike the due pill (due-pill.tsx), whose dueDate carries a
  // time-of-day and so compares directly. "Closed" on the roadmap means
  // completedAt is set (roadmap-view.tsx), so completed bars never flag.
  const DAY_MS = 86_400_000;
  const isOverdue =
    !isCompleted && card.targetDate.getTime() + DAY_MS <= Date.now();

  // Trailing assignee stack lives OUTSIDE the bar to the right. Suppressed
  // when there isn't enough free space before the next bar (or canvas edge)
  // in this row. Sizes: 16px avatar, 4px overlap → 12px per additional
  // chip. 4px gap from bar edge.
  const shown = Math.min(assignees.length, 2);
  const hasOverflowChip = assignees.length > 2;
  const stackChips = shown + (hasOverflowChip ? 1 : 0);
  const stackWidth = stackChips > 0 ? 16 + (stackChips - 1) * 12 : 0;
  const stackRequired = stackWidth + 4;
  const showAssignees =
    assignees.length > 0 && availableSpaceRight >= stackRequired;

  // Bars below this width can't fit a readable title + overflow trigger
  // without colliding into a "T... ⋯" mush. Below the threshold we strip
  // internals to a single type dot; full info comes via hover tooltip
  // and right-click menu.
  const compact = width < 60;

  return (
    <>
      <div
        ref={barRef}
        style={{
          left: x,
          width: Math.max(width, 12),
          top: row * 36 + 4,
          ...fill.style,
          // Red outline for overdue+open bars. Applied after fill.style so
          // it wins; uses the same --status-blocked token the due pill uses
          // for late items. blocked-status glow (boxShadow) is a separate
          // layer and is unaffected.
          ...(isOverdue ? { borderColor: "var(--status-blocked)" } : {}),
        }}
        className={`absolute h-7 rounded-md border border-fg/30 backdrop-blur-sm
                   hover:border-fg/60 transition-colors cursor-grab active:cursor-grabbing
                   flex items-center px-2 select-none group/bar pointer-events-auto
                   ${fill.className}
                   ${focused ? "ring-2 ring-fg/50" : ""}
                   ${tooltipOpen || menu ? "z-30" : ""}
                   ${isCompleted ? "opacity-55 saturate-50" : ""}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          cancelTooltip();
          e.preventDefault();
          onMoveStart(e, card.id);
        }}
        onMouseEnter={scheduleTooltip}
        onMouseLeave={cancelTooltip}
        onContextMenu={handleContextMenu}
        data-card-id={card.id}
        data-roadmap-focus={card.id}
        data-testid="roadmap-bar"
        data-status={status ?? "unmapped"}
        data-priority={priority ?? "none"}
        data-overdue={isOverdue ? "true" : "false"}
        aria-label={`Roadmap bar for ${card.title}`}
      >
        {/* Plan #16b-γ-G G4 — left-edge priority stripe (3px). Always
            rendered when priority is set, independent of gutter
            visibility. `pointer-events-none` so it doesn't swallow the
            resize handle's hit area. */}
        {priorityDot && (
          <span
            data-testid="roadmap-bar-priority-stripe"
            data-priority={priority}
            aria-hidden
            className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md pointer-events-none ${priorityDot}`}
          />
        )}
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
        {compact ? (
          <span
            aria-hidden
            className={`mr-1.5 inline-block size-1.5 rounded-full ${dot}`}
          />
        ) : (
          <button
            type="button"
            data-testid="roadmap-bar-complete-toggle"
            data-completed={isCompleted ? "true" : "false"}
            aria-label={
              isCompleted
                ? `Mark ${card.title} not complete`
                : `Mark ${card.title} complete`
            }
            aria-pressed={isCompleted}
            // Capture phase so we beat the bar's bubble-phase
            // onPointerDown (which kicks off `onMoveStart` and ate the
            // click). stopImmediatePropagation kills any sibling
            // handler in the same phase too.
            onPointerDownCapture={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onMouseDownCapture={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              handleToggleComplete();
            }}
            className={`relative z-20 mr-1.5 inline-flex items-center justify-center shrink-0 size-3 rounded-full border transition-colors focus:outline-none focus:ring-1 focus:ring-fg/40 ${
              isCompleted
                ? "bg-[color:var(--accent-lime)] border-[color:var(--accent-lime)]"
                : "border-fg/40 hover:border-fg/70"
            }`}
          >
            {isCompleted && (
              <Check
                aria-hidden
                className="size-2 stroke-[3] text-bg-deep"
              />
            )}
          </button>
        )}
        {!compact && (
          <span
            className={`text-xs text-fg truncate ${
              isCompleted ? "line-through" : ""
            }`}
          >
            {card.title}
          </span>
        )}
        {/* A2 — hover overflow trigger. Sits just left of the right resize
            handle. Stops drag from starting on press. Hidden on compact
            bars; right-click context menu replaces it. */}
        {!compact && (
          <button
            type="button"
            aria-label={`Open actions menu for ${card.title}`}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            data-testid="roadmap-bar-overflow"
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={openMenuFromTrigger}
            style={{ right: 14 }}
            className="absolute top-1/2 -translate-y-1/2 size-4 inline-flex items-center justify-center rounded text-fg/70 hover:text-fg hover:bg-[rgb(255_255_255/0.10)] opacity-0 group-hover/bar:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-fg/40 cursor-pointer z-10"
          >
            <MoreHorizontal className="size-3" />
          </button>
        )}
      </div>
      {showAssignees && (
        <span
          aria-label={`Assignees: ${assignees.map((a) => a.displayName).join(", ")}`}
          data-testid="roadmap-bar-assignees"
          className="absolute flex items-center -space-x-1 pointer-events-none"
          style={{
            left: x + Math.max(width, 12) + 4,
            top: row * 36 + 10,
            height: 16,
          }}
        >
          {assignees.slice(0, 2).map((m) => (
            <BarAvatar key={m.id} member={m} />
          ))}
          {hasOverflowChip && (
            <span
              className="inline-flex size-4 items-center justify-center rounded-full ring-1 ring-[color:var(--surface)] bg-fg/30 text-[8px] font-medium leading-none text-fg"
              title={assignees
                .slice(2)
                .map((a) => a.displayName)
                .join(", ")}
            >
              +{assignees.length - 2}
            </span>
          )}
        </span>
      )}
      {tooltipOpen && !menu && tooltipPos && typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            data-testid="roadmap-bar-tooltip"
            style={{
              position: "fixed",
              left: tooltipPos.left,
              top: tooltipPos.top,
              transform: "translateX(-50%)",
              zIndex: 60,
            }}
            className="w-64 rounded-md border border-hairline-hi bg-[color:var(--popover)] shadow-xl p-3 text-xs text-fg pointer-events-none"
          >
            <div className="serif-display text-base leading-tight">
              {card.title}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 mono-meta-sm">
              <dt className="text-fg-faint">TYPE</dt>
              <dd className="text-fg">{card.type.toUpperCase()}</dd>
              <dt className="text-fg-faint">STATUS</dt>
              <dd className="text-fg">
                {statusLabel ? statusLabel.toUpperCase() : "—"}
              </dd>
              <dt className="text-fg-faint">SPRINT</dt>
              <dd className="text-fg truncate">
                {sprintName ?? "—"}
              </dd>
              <dt className="text-fg-faint">SP</dt>
              <dd className="text-fg">
                {storyPoints !== null ? storyPoints : "—"}
              </dd>
              <dt className="text-fg-faint">START</dt>
              <dd className="text-fg">{formatDate(card.startDate)}</dd>
              <dt className="text-fg-faint">TARGET</dt>
              <dd className="text-fg">{formatDate(card.targetDate)}</dd>
              {card.completedAt && (
                <>
                  <dt className="text-fg-faint">DONE</dt>
                  <dd className="text-fg">{formatDate(card.completedAt)}</dd>
                </>
              )}
            </dl>
          </div>,
          document.body,
        )}
      <CardContextMenu
        menu={menu}
        setMenu={setMenu}
        isCompleted={isCompleted}
        priority={priority}
        testIdPrefix="roadmap-bar-menu"
        actions={{
          onOpen: handleOpenCard,
          onInBoard: handleInBoard,
          onEditDates: handleEditDates,
          onToggleComplete: handleToggleComplete,
          onSetPriority: handleSetPriority,
          onArchive: handleArchive,
          onOpenInNewView: () =>
            router.push(`/b/${card.boardId}/c/${card.id}`),
        }}
      />
      <Dialog open={datesOpen} onOpenChange={setDatesOpen}>
        <DialogContent data-testid="roadmap-bar-dates-dialog">
          <DialogHeader>
            <DialogTitle>Edit dates</DialogTitle>
            <DialogDescription>{card.title.toUpperCase()}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 text-xs">
              <span className="mono-meta-sm text-fg-faint">START</span>
              <div data-testid="roadmap-bar-dates-start">
                <DatePicker
                  value={isoToDate(datesStart)}
                  onChange={(d) => setDatesStart(dateToIso(d))}
                  triggerLabel="Set start"
                  inputLabel="Start date"
                />
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              <span className="mono-meta-sm text-fg-faint">TARGET</span>
              <div data-testid="roadmap-bar-dates-target">
                <DatePicker
                  value={isoToDate(datesTarget)}
                  onChange={(d) => setDatesTarget(dateToIso(d))}
                  triggerLabel="Set target"
                  inputLabel="Target date"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDatesOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveDates}
              data-testid="roadmap-bar-dates-save"
            >
              Save dates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
