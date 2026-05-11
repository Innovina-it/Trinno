"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { RefObject } from "react";
import { toast } from "sonner";
import { updateCard } from "@/actions/cards";
import {
  applyDragDelta,
  deltaPxToDays,
  isoDay,
  startOfDayUtc,
  type DateSpan,
  type DragMode,
} from "@/lib/workload/drag";

export type WorkloadDragOverride = DateSpan;

type DragState = {
  cardId: string;
  mode: DragMode;
  startClientX: number;
  orig: DateSpan;
  // True once the pointer crossed a small movement threshold during the
  // drag — we use this to suppress the bar's <Link> click on pointerup.
  moved: boolean;
  // Live preview-span. Mirrors the override map for the active drag, so
  // pointermove can build the date-tick overlay without re-reading the
  // map every frame.
  preview: DateSpan;
};

export type WorkloadDragApi = {
  // Start handlers wired to <WorkloadBar>'s pointerdown.
  beginDrag: (
    mode: DragMode,
    e: React.PointerEvent,
    cardId: string,
    span: DateSpan,
  ) => void;
  // Map of optimistic span overrides while drag/persist is in flight.
  overrides: Map<string, WorkloadDragOverride>;
  // Lightweight tick shown directly under the dragged bar.
  activeTick: {
    cardId: string;
    startISO: string;
    targetISO: string;
  } | null;
  // True once the pointer has actually moved past the click threshold.
  // <WorkloadBar> reads this to suppress its <Link> click so a
  // drag-and-release-on-bar doesn't accidentally navigate to the card.
  isDragging: boolean;
};

// Auto-scroll constants — keep modest so a casual hover near the edge
// doesn't yank the page.  Roadmap uses 60/12; workload feels nicer at
// the same numbers.
const HOT = 60;
const MAX_PX = 12;

export function useWorkloadDrag(
  scrollerRef: RefObject<HTMLDivElement | null>,
  pxPerDay: number,
): WorkloadDragApi {
  const dragRef = useRef<DragState | null>(null);
  const [overrides, setOverrides] = useState<Map<string, WorkloadDragOverride>>(
    () => new Map(),
  );
  const [activeTick, setActiveTick] = useState<WorkloadDragApi["activeTick"]>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [, startTransition] = useTransition();

  // Auto-scroll: drives scrollLeft in a RAF loop while the pointer is in
  // the left/right hot zone. We compensate for the consumed scroll by
  // fixing up `startClientX` so the world-relative deltaPx stays
  // consistent — same trick the roadmap harness uses.
  const lastClientXRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  const tickAutoScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    const drag = dragRef.current;
    if (!scroller || !drag) {
      autoScrollRafRef.current = null;
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const x = lastClientXRef.current;
    let dx = 0;
    if (x < rect.left + HOT) {
      const depth = Math.min(1, (rect.left + HOT - x) / HOT);
      dx = -Math.ceil(depth * MAX_PX);
    } else if (x > rect.right - HOT) {
      const depth = Math.min(1, (x - (rect.right - HOT)) / HOT);
      dx = Math.ceil(depth * MAX_PX);
    }
    if (dx !== 0) {
      const before = scroller.scrollLeft;
      scroller.scrollLeft = before + dx;
      const actualDx = scroller.scrollLeft - before;
      drag.startClientX -= actualDx;
    }
    autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
  }, [scrollerRef]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      lastClientXRef.current = e.clientX;
      if (!d.moved && Math.abs(e.clientX - d.startClientX) > 4) {
        d.moved = true;
        setIsDragging(true);
      }
      const deltaPx = e.clientX - d.startClientX;
      const deltaDays = deltaPxToDays(deltaPx, pxPerDay);
      const next = applyDragDelta(d.orig, d.mode, deltaDays);
      d.preview = next;
      setOverrides((prev) => {
        const m = new Map(prev);
        m.set(d.cardId, next);
        return m;
      });
      setActiveTick({
        cardId: d.cardId,
        startISO: isoDay(next.startDate),
        targetISO: isoDay(next.targetDate),
      });
      if (autoScrollRafRef.current === null) {
        autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
      }
    },
    [pxPerDay, tickAutoScroll],
  );

  // pointerup handler — captured by closure over the active drag.
  // We declare it as a ref so the start handler can register a single
  // window listener that mirrors the roadmap pattern. Using one stable
  // function across drags would force us to re-bind on every prop
  // change; doing it inside `beginDrag` keeps the listener lifecycle
  // explicit.
  const onPointerUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  const finishDrag = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      stopAutoScroll();
      window.removeEventListener("pointermove", onPointerMove);
      const upHandler = onPointerUpRef.current;
      if (upHandler) window.removeEventListener("pointerup", upHandler);
      onPointerUpRef.current = null;
      setActiveTick(null);
      // Defer clearing isDragging so the bar's onClick (fired right
      // after pointerup) sees `isDragging===true` and bails out of
      // navigation. Clearing it synchronously here would make the
      // <Link> activate after a real drag.
      setTimeout(() => setIsDragging(false), 0);

      if (!d) return;
      const noOp =
        d.preview.startDate.getTime() === d.orig.startDate.getTime() &&
        d.preview.targetDate.getTime() === d.orig.targetDate.getTime();
      if (!commit || noOp) {
        // Drop the override unless we're persisting it.
        setOverrides((prev) => {
          if (!prev.has(d.cardId)) return prev;
          const m = new Map(prev);
          m.delete(d.cardId);
          return m;
        });
        return;
      }

      const cardId = d.cardId;
      const next = d.preview;
      // Keep the override in place until the server confirms — the
      // realtime CDC echo (useWorkloadSync → router.refresh) will
      // re-render with the saved span and we'll clear the override
      // when we see it's redundant. Until then the bar reads from the
      // override so it doesn't snap back.
      startTransition(() => {
        void (async () => {
          try {
            await updateCard({
              id: cardId,
              startDate: next.startDate.toISOString(),
              targetDate: next.targetDate.toISOString(),
            });
            // Hold the override briefly — the realtime echo will
            // re-render with the new server-side span and we drop
            // ours after a short delay so the UI never flickers
            // back to the original.
            setTimeout(() => {
              setOverrides((prev) => {
                if (!prev.has(cardId)) return prev;
                const m = new Map(prev);
                m.delete(cardId);
                return m;
              });
            }, 1200);
          } catch (err) {
            setOverrides((prev) => {
              if (!prev.has(cardId)) return prev;
              const m = new Map(prev);
              m.delete(cardId);
              return m;
            });
            toast.error((err as Error).message ?? "Failed to update dates");
          }
        })();
      });
    },
    [onPointerMove, stopAutoScroll],
  );

  const beginDrag = useCallback(
    (mode: DragMode, e: React.PointerEvent, cardId: string, span: DateSpan) => {
      // Don't start a drag on right-click or middle-click.
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const orig: DateSpan = {
        startDate: startOfDayUtc(span.startDate),
        targetDate: startOfDayUtc(span.targetDate),
      };
      dragRef.current = {
        cardId,
        mode,
        startClientX: e.clientX,
        orig,
        moved: false,
        preview: orig,
      };
      lastClientXRef.current = e.clientX;
      const onUp = () => finishDrag(true);
      onPointerUpRef.current = onUp;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onUp);
    },
    [finishDrag, onPointerMove],
  );

  // Esc cancels.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dragRef.current) {
        finishDrag(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDrag]);

  // Cleanup any straggling listeners if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      const upHandler = onPointerUpRef.current;
      if (upHandler) window.removeEventListener("pointerup", upHandler);
      stopAutoScroll();
    };
  }, [onPointerMove, stopAutoScroll]);

  return { beginDrag, overrides, activeTick, isDragging };
}
