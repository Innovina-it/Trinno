"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, X, ExternalLink } from "lucide-react";
import type { WorkloadCard } from "@/lib/queries/workload";

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

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function spanDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

export function WorkloadBar({
  card,
  x,
  width,
  top,
  height,
}: {
  card: WorkloadCard;
  x: number;
  width: number;
  top: number;
  height: number;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<{ x: number; y: number } | null>(
    null,
  );
  const router = useRouter();
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

  return (
    <>
      <Link
        href={`/b/${card.boardId}/c/${card.id}`}
        scroll={false}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onContextMenu={onContextMenu}
        data-testid="workload-bar"
        data-card-id={card.id}
        data-role={card.role}
        className="absolute rounded-md text-xs leading-none flex items-center overflow-hidden whitespace-nowrap text-fg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
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
          className="px-2 truncate"
          style={{ paddingLeft: priorityStripe ? 8 : undefined }}
        >
          {card.title}
        </span>
      </Link>

      {tooltipOpen && (
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
            {fmt(card.startDate)} → {fmt(card.targetDate)} ·{" "}
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
