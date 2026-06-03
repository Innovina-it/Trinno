"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  CalendarRange,
  CheckCircle2,
  ExternalLink,
  Flag,
  LayoutGrid,
  MousePointerClick,
} from "lucide-react";
import {
  PRIORITY_LABELS,
  PRIORITY_TINT,
  type CardPriority,
} from "./priority-picker";

export type CardContextMenuPosition = { x: number; y: number };

export type CardContextMenuActions = {
  onOpen?: () => void;
  onInBoard?: () => void;
  onEditDates?: () => void;
  onToggleComplete?: () => void;
  onSetPriority?: (priority: CardPriority | null) => void;
  onArchive?: () => void;
  onOpenInNewView?: () => void;
};

const PRIORITIES: CardPriority[] = ["p0", "p1", "p2", "p3", "p4"];

export function CardContextMenu({
  menu,
  setMenu,
  isCompleted,
  priority,
  actions,
  testIdPrefix = "card-context-menu",
}: {
  menu: CardContextMenuPosition | null;
  setMenu: (m: CardContextMenuPosition | null) => void;
  isCompleted: boolean;
  priority: CardPriority | null;
  actions: CardContextMenuActions;
  testIdPrefix?: string;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

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
  }, [menu, setMenu]);

  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!menu) {
      setMenuPos(null);
      return;
    }
    const node = menuRef.current;
    if (!node) {
      setMenuPos({ top: menu.y, left: menu.x });
      return;
    }
    const rect = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    let top = menu.y;
    let left = menu.x;
    if (top + rect.height + margin > vh) {
      top = Math.max(margin, menu.y - rect.height);
    }
    if (left + rect.width + margin > vw) {
      left = Math.max(margin, menu.x - rect.width);
    }
    setMenuPos({ top, left });
  }, [menu]);

  if (!menu || typeof document === "undefined") return null;

  const menuStyle: CSSProperties = {
    position: "fixed",
    top: menuPos?.top ?? -9999,
    left: menuPos?.left ?? -9999,
    zIndex: 100,
    visibility: menuPos ? "visible" : "hidden",
  };

  const run = (fn: (() => void) | undefined) => () => {
    setMenu(null);
    fn?.();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid={testIdPrefix}
      onPointerDown={(e) => e.stopPropagation()}
      style={menuStyle}
      className="min-w-48 max-h-[calc(100vh-16px)] overflow-y-auto rounded-md border border-hairline-hi bg-[color:var(--popover)] shadow-xl py-1 text-sm"
    >
      {actions.onOpen && (
        <button
          type="button"
          role="menuitem"
          onClick={run(actions.onOpen)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-fg hover:bg-[rgb(255_255_255/0.06)]"
          data-testid={`${testIdPrefix}-open-card`}
        >
          <MousePointerClick className="size-3" />
          Open card
        </button>
      )}
      {actions.onInBoard && (
        <button
          type="button"
          role="menuitem"
          onClick={run(actions.onInBoard)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-fg hover:bg-[rgb(255_255_255/0.06)]"
          data-testid={`${testIdPrefix}-in-board`}
        >
          <LayoutGrid className="size-3" />
          In board
        </button>
      )}
      {actions.onEditDates && (
        <button
          type="button"
          role="menuitem"
          onClick={run(actions.onEditDates)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-fg hover:bg-[rgb(255_255_255/0.06)]"
          data-testid={`${testIdPrefix}-edit-dates`}
        >
          <CalendarRange className="size-3" />
          Edit dates
        </button>
      )}
      {actions.onToggleComplete && (
        <button
          type="button"
          role="menuitem"
          onClick={run(actions.onToggleComplete)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-fg hover:bg-[rgb(255_255_255/0.06)]"
          data-testid={`${testIdPrefix}-complete`}
        >
          <CheckCircle2 className="size-3" />
          {isCompleted ? "Mark not complete" : "Mark complete"}
        </button>
      )}
      {actions.onSetPriority && (
        <>
          <div className="my-1 border-t border-hairline" />
          {PRIORITIES.map((p) => {
            const selected = p === priority;
            return (
              <button
                key={p}
                type="button"
                role="menuitem"
                aria-current={selected ? "true" : undefined}
                onClick={run(() => actions.onSetPriority?.(p))}
                className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[rgb(255_255_255/0.06)] ${PRIORITY_TINT[p].text} ${selected ? "bg-[rgb(255_255_255/0.06)]" : ""}`}
                data-testid={`${testIdPrefix}-set-priority`}
                data-priority={p}
                data-selected={selected ? "true" : undefined}
              >
                <span
                  aria-hidden
                  className={`size-2 rounded-full ${PRIORITY_TINT[p].dot}`}
                />
                <Flag className={`size-3 ${selected ? "fill-current" : ""}`} />
                Set {PRIORITY_LABELS[p]}
              </button>
            );
          })}
          {priority !== null && (
            <button
              type="button"
              role="menuitem"
              onClick={run(() => actions.onSetPriority?.(null))}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-fg-muted hover:bg-[rgb(255_255_255/0.06)]"
              data-testid={`${testIdPrefix}-clear-priority`}
            >
              <Flag className="size-3" />
              Clear priority
            </button>
          )}
        </>
      )}
      {actions.onArchive && (
        <>
          <div className="my-1 border-t border-hairline" />
          <button
            type="button"
            role="menuitem"
            onClick={run(actions.onArchive)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-fg hover:bg-[rgb(255_255_255/0.06)]"
            data-testid={`${testIdPrefix}-archive`}
          >
            <Archive className="size-3" />
            Archive
          </button>
        </>
      )}
      {actions.onOpenInNewView && (
        <>
          <div className="my-1 border-t border-hairline" />
          <button
            type="button"
            role="menuitem"
            onClick={run(actions.onOpenInNewView)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-fg-muted hover:bg-[rgb(255_255_255/0.06)]"
            data-testid={`${testIdPrefix}-open-board`}
          >
            <ExternalLink className="size-3" />
            Open in new view
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
