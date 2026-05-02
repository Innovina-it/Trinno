"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoadmapCard } from "@/lib/queries/roadmap";
import { dayDiff, startOfDay } from "@/lib/roadmap/dates";

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
}: {
  cards: RoadmapCard[];
  gridStart: Date;
  gridEnd: Date;
  canvasWidth: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapWidth, setMapWidth] = useState<number>(0);
  const [scrollState, setScrollState] = useState<ScrollState>({
    left: 0,
    width: 0,
    scrollWidth: 0,
  });

  // Track the rendered width of the mini-map container so we can scale
  // canvas coords -> mini coords. Falls back to a sensible default for
  // SSR / first paint.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () => setMapWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Track the canvas scroller's scrollLeft + clientWidth + scrollWidth so
  // the viewport rect mirrors the live state.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const handler = () => {
      setScrollState({
        left: scroller.scrollLeft,
        width: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
      });
    };
    handler();
    scroller.addEventListener("scroll", handler, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(handler);
      ro.observe(scroller);
    }
    return () => {
      scroller.removeEventListener("scroll", handler);
      if (ro) ro.disconnect();
    };
  }, [scrollerRef]);

  // Re-snapshot scroller state when canvas width / cards change (the
  // canvas may have grown beyond the previously-known scrollWidth).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setScrollState({
      left: scroller.scrollLeft,
      width: scroller.clientWidth,
      scrollWidth: scroller.scrollWidth,
    });
  }, [canvasWidth, cards.length, scrollerRef]);

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

  return (
    <div
      ref={mapRef}
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

      {/* Viewport indicator — draggable handle. */}
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
        />
      )}
    </div>
  );
}
