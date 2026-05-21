"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RoadmapCard } from "@/lib/queries/roadmap";
import { dayDiff, startOfDay, type Zoom } from "@/lib/roadmap/dates";

// Continuous-zoom ppd bounds. ~120 px/day is week zoom doubled; 2 px/day
// is well below quarter zoom (8) so the user can zoom out arbitrarily far.
const MIN_PPD = 2;
const MAX_PPD = 120;

// Plan #16b-γ Group C, Task C6 — Compressed-overview navigational strip
// rendered above the canvas scroller. Mirrors the pattern most pro Gantt
// tools have: a thumbnail of the full date range with one tiny rect per
// card, plus a draggable rectangle indicating the current scroll
// viewport. Click to recenter, drag to pan.

type ScrollState = { left: number; width: number; scrollWidth: number };

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function RoadmapMiniMap({
  cards,
  gridStart,
  gridEnd,
  canvasWidth,
  scrollerRef,
  zoom,
  onSetZoom,
  effectivePpd,
  onPpdOverride,
}: {
  cards: RoadmapCard[];
  gridStart: Date;
  gridEnd: Date;
  canvasWidth: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  zoom: Zoom;
  onSetZoom: (next: Zoom) => void;
  /** Current pixels-per-day applied to the canvas (after any override). */
  effectivePpd: number;
  /** Push a live pixels-per-day to the canvas. Pass null to release. */
  onPpdOverride: (ppd: number | null) => void;
}) {
  // zoom + onSetZoom are unused here for now (header owns the discrete
  // selector), but kept on the prop API so the mini-map can later commit
  // a snap-to-discrete on release without another prop dance.
  void zoom;
  void onSetZoom;
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObserverRef = useRef<ResizeObserver | null>(null);
  const [mapWidth, setMapWidth] = useState<number>(0);
  const [scrollState, setScrollState] = useState<ScrollState>({
    left: 0,
    width: 0,
    scrollWidth: 0,
  });

  // Snapshot scroller dims into state. Shared by every code path that
  // needs a fresh read (mount, scroll, observe, strip re-attach).
  const snapshotScroller = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {
      left: scroller.scrollLeft,
      width: scroller.clientWidth,
      scrollWidth: scroller.scrollWidth,
    };
    setScrollState((prev) =>
      prev.left === next.left &&
      prev.width === next.width &&
      prev.scrollWidth === next.scrollWidth
        ? prev
        : next,
    );
  }, [scrollerRef]);

  // Callback ref: fires on every mount + unmount of the strip div. Auto-hide
  // toggles the strip via `return null`; without this, the ResizeObserver
  // attached once at first mount would keep observing the detached div after
  // the next re-show, and mapWidth would stay stale. Re-binding here also
  // re-snapshots the scroller so the viewport rect renders at correct size
  // the instant the strip re-appears (filter Mine→All, etc.).
  const setMapEl = useCallback(
    (el: HTMLDivElement | null) => {
      mapRef.current = el;
      if (mapObserverRef.current) {
        mapObserverRef.current.disconnect();
        mapObserverRef.current = null;
      }
      if (!el) return;
      setMapWidth(el.getBoundingClientRect().width);
      snapshotScroller();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => {
          const cur = mapRef.current;
          if (!cur) return;
          setMapWidth(cur.getBoundingClientRect().width);
        });
        ro.observe(el);
        mapObserverRef.current = ro;
      }
    },
    [snapshotScroller],
  );

  // Disconnect on full unmount.
  useEffect(() => {
    return () => {
      if (mapObserverRef.current) {
        mapObserverRef.current.disconnect();
        mapObserverRef.current = null;
      }
    };
  }, []);

  // Track the canvas scroller's scrollLeft + clientWidth + scrollWidth so
  // the viewport rect mirrors the live state.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    snapshotScroller();
    scroller.addEventListener("scroll", snapshotScroller, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(snapshotScroller);
      ro.observe(scroller);
    }
    return () => {
      scroller.removeEventListener("scroll", snapshotScroller);
      if (ro) ro.disconnect();
    };
  }, [scrollerRef, snapshotScroller]);

  // Re-snapshot scroller state when canvas width / cards / ppd change (the
  // canvas may have grown beyond the previously-known scrollWidth). Without
  // `effectivePpd` here, switching filter→ppd-override→filter could leave
  // scrollState stale because canvasWidth alone may not change.
  useEffect(() => {
    snapshotScroller();
  }, [canvasWidth, cards.length, effectivePpd, snapshotScroller]);

  const ratio =
    canvasWidth > 0 && mapWidth > 0 ? mapWidth / canvasWidth : 0;
  const totalDays = Math.max(1, dayDiff(gridStart, gridEnd));
  const dayWidthOnMap = mapWidth > 0 ? mapWidth / totalDays : 0;

  // Imperative scroll helper, clamps to valid range.
  const scrollToCanvasLeft = useCallback(
    (left: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollLeft = clamp(left, 0, max);
    },
    [scrollerRef],
  );

  // Background click: recenter the viewport on the clicked x.
  const onBackgroundPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    const map = mapRef.current;
    if (!map || ratio <= 0) return;
    const rect = map.getBoundingClientRect();
    const mapX = e.clientX - rect.left;
    const canvasX = mapX / ratio;
    scrollToCanvasLeft(canvasX - scrollState.width / 2);
  };

  // Drag the viewport rectangle. We track the pointer at the window
  // level so the user can swing past the edges of the strip without
  // losing the grab.
  const dragState = useRef<{
    pointerId: number;
    startClientX: number;
    startScrollLeft: number;
  } | null>(null);

  const onRectPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const scroller = scrollerRef.current;
    if (!scroller) return;
    dragState.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startScrollLeft: scroller.scrollLeft,
    };
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      // Some browsers throw on lost pointers; ignore.
    }
  };

  const onRectPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    if (ratio <= 0) return;
    const dx = e.clientX - ds.startClientX;
    const canvasDx = dx / ratio;
    scrollToCanvasLeft(ds.startScrollLeft + canvasDx);
  };

  const endRectDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
    dragState.current = null;
  };

  const viewportLeft = scrollState.left * ratio;
  const viewportWidthPx = Math.max(8, scrollState.width * ratio);

  // --- Continuous zoom via edge resize ------------------------------------
  // Each pointermove computes the desired pixels-per-day from the new bar
  // width on the mini-map and pushes it up via onPpdOverride. The parent
  // re-renders the canvas at the new density, scrollWidth grows/shrinks,
  // and a layout effect re-pins the scroller so the anchor day stays
  // glued under the handle the user is dragging.
  const resizeState = useRef<{
    pointerId: number;
    edge: "left" | "right";
    startClientX: number;
    startBarWidth: number;
    /** Day index (since gridStart) that stays pinned under the immobile
     *  handle. Right-edge resize pins the bar's left edge; left-edge
     *  resize pins the bar's right edge. */
    anchorDay: number;
  } | null>(null);

  const totalDaysCanvas = Math.max(1, dayDiff(gridStart, gridEnd));

  // Capture clientWidth in a ref so pointermove can read it without
  // re-binding listeners every render.
  const clientWidthRef = useRef(0);
  clientWidthRef.current = scrollState.width;

  const onResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    edge: "left" | "right",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const scroller = scrollerRef.current;
    if (!scroller || effectivePpd <= 0) return;
    const anchorScrollX =
      edge === "right" ? scroller.scrollLeft : scroller.scrollLeft + scroller.clientWidth;
    resizeState.current = {
      pointerId: e.pointerId,
      edge,
      startClientX: e.clientX,
      startBarWidth: viewportWidthPx,
      anchorDay: anchorScrollX / effectivePpd,
    };
    try {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore — some browsers throw on already-captured pointers
    }
  };

  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rs = resizeState.current;
    if (!rs || rs.pointerId !== e.pointerId) return;
    if (mapWidth <= 0) return;
    const clientWidth = clientWidthRef.current;
    if (clientWidth <= 0) return;
    const dx = e.clientX - rs.startClientX;
    const deltaBar = rs.edge === "right" ? dx : -dx;
    // Bar shrinks ⇒ canvas grows ⇒ higher ppd (zoom in). Bar can't go
    // below a couple of pixels or above mapWidth.
    const newBarWidth = clamp(rs.startBarWidth + deltaBar, 4, mapWidth);
    // canvasWidth = clientWidth * mapWidth / barWidth (derived from
    // bar = clientWidth/canvas * mapWidth).
    const newCanvas = (clientWidth * mapWidth) / newBarWidth;
    const newPpd = clamp(newCanvas / totalDaysCanvas, MIN_PPD, MAX_PPD);
    onPpdOverride(newPpd);
  };

  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const rs = resizeState.current;
    if (!rs || rs.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    resizeState.current = null;
    // Note: we deliberately keep the dragPpdOverride active so the user
    // sees their chosen density persist after release. Picking a zoom
    // from the header (or refreshing) clears it.
  };

  // Re-pin the scroller to the captured anchor day every time the
  // canvas resizes during an active drag. Without this, the day under
  // the user's pointer would drift as ppd changes.
  useLayoutEffect(() => {
    const rs = resizeState.current;
    if (!rs) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const anchorPx = rs.anchorDay * effectivePpd;
    const nextScrollLeft =
      rs.edge === "right" ? anchorPx : anchorPx - scroller.clientWidth;
    scroller.scrollLeft = clamp(nextScrollLeft, 0, max);
  }, [effectivePpd, canvasWidth, scrollerRef]);

  // Auto-hide when canvas fits the viewport. Mini-map adds nothing when
  // there is nothing to scroll. 4px tolerance for sub-pixel rounding.
  const fits =
    scrollState.scrollWidth > 0 &&
    scrollState.scrollWidth <= scrollState.width + 4;
  if (fits) return null;

  return (
    <div
      ref={setMapEl}
      className="relative h-12 rounded-md border border-hairline bg-fg/[0.02] overflow-hidden cursor-pointer select-none"
      data-testid="roadmap-mini-map"
      onPointerDown={onBackgroundPointerDown}
      role="presentation"
    >
      {/* Compressed card marks. Decorative — actual interactivity lives
          on the viewport rect + the strip background. */}
      {ratio > 0 &&
        cards.map((c) => {
          const sx =
            Math.max(0, dayDiff(gridStart, startOfDay(c.startDate))) *
            dayWidthOnMap;
          const ex =
            Math.max(0, dayDiff(gridStart, startOfDay(c.targetDate))) *
              dayWidthOnMap +
            dayWidthOnMap;
          const w = Math.max(1, ex - sx);
          return (
            <div
              key={c.id}
              aria-hidden
              data-testid="roadmap-mini-mark"
              className="absolute bg-fg/30 rounded-[1px] pointer-events-none"
              style={{
                left: clamp(sx, 0, mapWidth),
                width: clamp(w, 1, Math.max(1, mapWidth - sx)),
                top: "50%",
                height: 3,
                transform: "translateY(-50%)",
              }}
            />
          );
        })}

      {/* Viewport indicator — draggable + edge-resize. Pan from the body,
          zoom from either edge handle. */}
      {ratio > 0 && scrollState.width > 0 && (
        <div
          data-testid="roadmap-mini-viewport"
          role="slider"
          aria-label="Roadmap viewport"
          aria-valuemin={0}
          aria-valuemax={Math.max(
            0,
            scrollState.scrollWidth - scrollState.width,
          )}
          aria-valuenow={Math.round(scrollState.left)}
          tabIndex={0}
          onPointerDown={onRectPointerDown}
          onPointerMove={onRectPointerMove}
          onPointerUp={endRectDrag}
          onPointerCancel={endRectDrag}
          className="absolute top-0 bottom-0 bg-fg/10 border border-fg/40 rounded-sm cursor-grab active:cursor-grabbing"
          style={{
            left: clamp(viewportLeft, 0, Math.max(0, mapWidth - 1)),
            width: clamp(
              viewportWidthPx,
              8,
              Math.max(8, mapWidth - clamp(viewportLeft, 0, mapWidth)),
            ),
          }}
        >
          <div
            data-testid="roadmap-mini-viewport-resize-left"
            aria-label="Resize viewport (zoom)"
            role="separator"
            onPointerDown={(e) => onResizePointerDown(e, "left")}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute inset-y-0 left-0 w-2 -translate-x-1/2 cursor-ew-resize group flex items-center justify-center"
          >
            <span className="block h-5 w-[2px] rounded-full bg-fg/55 group-hover:bg-fg group-active:bg-fg transition-colors" />
          </div>
          <div
            data-testid="roadmap-mini-viewport-resize-right"
            aria-label="Resize viewport (zoom)"
            role="separator"
            onPointerDown={(e) => onResizePointerDown(e, "right")}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute inset-y-0 right-0 w-2 translate-x-1/2 cursor-ew-resize group flex items-center justify-center"
          >
            <span className="block h-5 w-[2px] rounded-full bg-fg/55 group-hover:bg-fg group-active:bg-fg transition-colors" />
          </div>
        </div>
      )}

    </div>
  );
}
