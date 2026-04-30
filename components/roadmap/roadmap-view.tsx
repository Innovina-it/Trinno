"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { RoadmapCard, RoadmapLink } from "@/lib/queries/roadmap";
import {
  addDays,
  dayDiff,
  gridEndFor,
  gridStartFor,
  pixelsPerDay,
  startOfDay,
  xForDate,
  type Zoom,
} from "@/lib/roadmap/dates";
import { groupByEpic, stackInLane } from "@/lib/roadmap/layout";
import { updateCard } from "@/actions/cards";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { RoadmapBar } from "./roadmap-bar";
import { DependencyArrows, type BarBox } from "./dependency-arrows";

const ZOOMS: Zoom[] = ["week", "month", "quarter"];
const ROW_HEIGHT = 36; // 28px bar + 8px gap
const LANE_HEADER_HEIGHT = 28;
const LANE_GAP = 12;
const HEADER_STRIP_HEIGHT = 36;
const LANE_LABEL_WIDTH = 200;

type DragMode = "move" | "resize-left" | "resize-right";

type DragState = {
  cardId: string;
  mode: DragMode;
  startClientX: number;
  origStart: Date;
  origTarget: Date;
};

function fmtHeader(d: Date, zoom: Zoom): string {
  const monthShort = d.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  if (zoom === "week") {
    return `${monthShort} ${d.getUTCDate()}`;
  }
  if (zoom === "month") {
    return `${monthShort} ${d.getUTCFullYear()}`;
  }
  // quarter
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${d.getUTCFullYear()}`;
}

function buildHeaderTicks(
  gridStart: Date,
  gridEnd: Date,
  zoom: Zoom,
): { date: Date; x: number }[] {
  const ppd = pixelsPerDay(zoom);
  const ticks: { date: Date; x: number }[] = [];
  if (zoom === "week") {
    let cur = gridStart;
    while (cur.getTime() <= gridEnd.getTime()) {
      ticks.push({ date: cur, x: xForDate(cur, gridStart, ppd) });
      cur = addDays(cur, 7);
    }
  } else if (zoom === "month") {
    let cur = new Date(
      Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), 1),
    );
    while (cur.getTime() <= gridEnd.getTime()) {
      ticks.push({ date: cur, x: xForDate(cur, gridStart, ppd) });
      cur = new Date(
        Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1),
      );
    }
  } else {
    // quarter
    let cur = new Date(
      Date.UTC(
        gridStart.getUTCFullYear(),
        gridStart.getUTCMonth() - (gridStart.getUTCMonth() % 3),
        1,
      ),
    );
    while (cur.getTime() <= gridEnd.getTime()) {
      ticks.push({ date: cur, x: xForDate(cur, gridStart, ppd) });
      cur = new Date(
        Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 3, 1),
      );
    }
  }
  return ticks;
}

export function RoadmapView({
  // `initialCards` / `initialLinks` are kept as a fallback for SSR-seeded
  // renders that don't (yet) wrap the workspace store provider — the page
  // wraps it now, so these are effectively unused in production. We still
  // accept them so existing tests / call sites don't break.
  initialCards: _initialCards,
  initialLinks: _initialLinks,
  workspaceId,
}: {
  initialCards: RoadmapCard[];
  initialLinks: RoadmapLink[];
  workspaceId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const zoomParam = sp.get("zoom");
  const zoom: Zoom = (ZOOMS as string[]).includes(zoomParam ?? "")
    ? (zoomParam as Zoom)
    : "month";

  const { subscribed } = useWorkspaceRealtime(workspaceId);

  // Read cards directly from the workspace store, projecting to the
  // RoadmapCard shape the layout helpers expect.
  const storeCards = useWorkspaceStore((s) => s.cards);
  const storeBoards = useWorkspaceStore((s) => s.boards);
  const storeLinks = useWorkspaceStore((s) => s.cardLinks);
  const patchCardInStore = useWorkspaceStore((s) => s.patchCard);

  const cards = useMemo<RoadmapCard[]>(() => {
    const boardTitleById = new Map(storeBoards.map((b) => [b.id, b.title]));
    return storeCards
      .filter(
        (c) =>
          !c.archived &&
          c.startDate !== null &&
          c.targetDate !== null &&
          // Subtasks are nested under their parent — Task 6 renders them
          // separately. Only top-level types appear in the lane bars.
          c.type !== "subtask",
      )
      .map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        parentCardId: c.parentCardId,
        startDate: c.startDate as Date,
        targetDate: c.targetDate as Date,
        boardId: c.boardId,
        boardTitle: boardTitleById.get(c.boardId) ?? "",
        archived: c.archived,
      }));
  }, [storeCards, storeBoards]);

  const links = useMemo<RoadmapLink[]>(
    () =>
      storeLinks
        .filter((l) => l.kind === "is_blocked_by")
        .map((l) => ({ fromId: l.fromCardId, toId: l.toCardId })),
    [storeLinks],
  );

  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const ppd = pixelsPerDay(zoom);
  const now = useMemo(() => new Date(), []);
  const gridStart = useMemo(() => gridStartFor(now, zoom), [now, zoom]);
  const gridEnd = useMemo(() => {
    const baseEnd = gridEndFor(gridStart, zoom);
    // Extend to cover any card past 6 months.
    const maxTarget = cards.reduce(
      (acc, c) => (c.targetDate.getTime() > acc ? c.targetDate.getTime() : acc),
      baseEnd.getTime(),
    );
    return new Date(maxTarget);
  }, [cards, gridStart, zoom]);
  const totalDays = Math.max(1, dayDiff(gridStart, gridEnd));
  const width = totalDays * ppd;

  const lanes = useMemo(() => groupByEpic(cards), [cards]);

  // Per-lane stacking + total height.
  const laneLayout = useMemo(() => {
    let yCursor = HEADER_STRIP_HEIGHT;
    return lanes.map((lane) => {
      const placed = stackInLane(lane.cards);
      const rowsCount =
        placed.length === 0 ? 0 : Math.max(...placed.map((p) => p.row + 1));
      const headerRows = lane.headerCard ? 1 : 0;
      const bodyRows = Math.max(rowsCount, headerRows);
      const height =
        LANE_HEADER_HEIGHT +
        Math.max(1, bodyRows) * ROW_HEIGHT +
        LANE_GAP;
      const top = yCursor;
      yCursor += height;
      return { lane, placed, top, height, headerRows, bodyRows };
    });
  }, [lanes]);

  const totalHeight =
    laneLayout.length === 0
      ? HEADER_STRIP_HEIGHT + 80
      : laneLayout[laneLayout.length - 1].top +
        laneLayout[laneLayout.length - 1].height;

  // Bar boxes for arrow rendering.
  const barCoords = useMemo(() => {
    const map = new Map<string, BarBox>();
    for (const ll of laneLayout) {
      const barRowsTop = ll.top + LANE_HEADER_HEIGHT;
      if (ll.lane.headerCard) {
        const c = ll.lane.headerCard;
        const x = xForDate(startOfDay(c.startDate), gridStart, ppd);
        const w =
          xForDate(startOfDay(c.targetDate), gridStart, ppd) - x + ppd;
        map.set(c.id, {
          x,
          y: barRowsTop + 4 + 14, // top + bar offset + half-height (28/2)
          w,
        });
      }
      // Body bars start below header (whether or not the headerCard is set).
      const bodyTop = barRowsTop + (ll.lane.headerCard ? ROW_HEIGHT : 0);
      for (const p of ll.placed) {
        const c = p.card;
        const x = xForDate(startOfDay(c.startDate), gridStart, ppd);
        const w =
          xForDate(startOfDay(c.targetDate), gridStart, ppd) - x + ppd;
        map.set(c.id, {
          x,
          y: bodyTop + p.row * ROW_HEIGHT + 4 + 14,
          w,
        });
      }
    }
    return map;
  }, [laneLayout, gridStart, ppd]);

  const ticks = useMemo(
    () => buildHeaderTicks(gridStart, gridEnd, zoom),
    [gridStart, gridEnd, zoom],
  );

  // ---- Zoom toggle (URL-synced) ----
  function setZoom(next: Zoom) {
    const params = new URLSearchParams(sp.toString());
    params.set("zoom", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // ---- Drag state (refs to avoid re-renders during pointermove) ----
  const dragRef = useRef<DragState | null>(null);
  const [, startTransition] = useTransition();

  const persistDates = useCallback(
    async (
      cardId: string,
      orig: { start: Date; target: Date },
      next: { start: Date; target: Date },
    ) => {
      try {
        await updateCard({
          id: cardId,
          startDate: next.start.toISOString(),
          targetDate: next.target.toISOString(),
        });
        // Don't manually re-set the store: the realtime CDC echo will
        // reconcile via `useWorkspaceRealtime`. Server-side
        // `revalidatePath` also refreshes the SSR snapshot on next nav.
      } catch (err) {
        // Revert the optimistic patch on failure.
        patchCardInStore(cardId, { startDate: orig.start, targetDate: orig.target });
        toast.error((err as Error).message);
      }
    },
    [patchCardInStore],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaPx = e.clientX - d.startClientX;
      const deltaDays = Math.round(deltaPx / ppd);
      let nextStart = d.origStart;
      let nextTarget = d.origTarget;
      if (d.mode === "move") {
        nextStart = addDays(d.origStart, deltaDays);
        nextTarget = addDays(d.origTarget, deltaDays);
      } else if (d.mode === "resize-left") {
        nextStart = addDays(d.origStart, deltaDays);
        if (nextStart.getTime() > nextTarget.getTime()) {
          nextStart = nextTarget;
        }
      } else if (d.mode === "resize-right") {
        nextTarget = addDays(d.origTarget, deltaDays);
        if (nextTarget.getTime() < nextStart.getTime()) {
          nextTarget = nextStart;
        }
      }
      // Patch the store directly so the bar tracks the cursor immediately.
      patchCardInStore(d.cardId, {
        startDate: nextStart,
        targetDate: nextTarget,
      });
    },
    [ppd, patchCardInStore],
  );

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const current = cardsRef.current.find((c) => c.id === d.cardId);
    if (!current) return;
    if (
      current.startDate.getTime() === d.origStart.getTime() &&
      current.targetDate.getTime() === d.origTarget.getTime()
    ) {
      return; // no-op
    }
    startTransition(() => {
      void persistDates(
        d.cardId,
        { start: d.origStart, target: d.origTarget },
        { start: current.startDate, target: current.targetDate },
      );
    });
  }, [onPointerMove, persistDates]);

  const beginDrag = useCallback(
    (mode: DragMode, e: React.PointerEvent, cardId: string) => {
      const c = cardsRef.current.find((x) => x.id === cardId);
      if (!c) return;
      e.preventDefault();
      dragRef.current = {
        cardId,
        mode,
        startClientX: e.clientX,
        origStart: c.startDate,
        origTarget: c.targetDate,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  const handleMoveStart = useCallback(
    (e: React.PointerEvent, cardId: string) => beginDrag("move", e, cardId),
    [beginDrag],
  );
  const handleResizeLeftStart = useCallback(
    (e: React.PointerEvent, cardId: string) =>
      beginDrag("resize-left", e, cardId),
    [beginDrag],
  );
  const handleResizeRightStart = useCallback(
    (e: React.PointerEvent, cardId: string) =>
      beginDrag("resize-right", e, cardId),
    [beginDrag],
  );

  const handleOpenCard = useCallback(
    (cardId: string, boardId: string) => {
      router.push(`/b/${boardId}/c/${cardId}`);
    },
    [router],
  );

  // Cleanup any dangling listeners if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // Keep the dependency-arrows links list filtered to visible bars only.
  const visibleLinks = useMemo(
    () =>
      links.filter(
        (l) => barCoords.has(l.fromId) && barCoords.has(l.toId),
      ),
    [links, barCoords],
  );

  return (
    <div
      data-testid="roadmap-view"
      data-workspace-id={workspaceId}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="roadmap-zoom"
              className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]"
            >
              ZOOM: {zoom.toUpperCase()}
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={zoom}
                onValueChange={(v) => setZoom(v as Zoom)}
              >
                {ZOOMS.map((z) => (
                  <DropdownMenuRadioItem key={z} value={z}>
                    {z[0].toUpperCase() + z.slice(1)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span
            className="inline-flex items-center gap-1.5 mono-meta-sm text-fg-faint"
            data-testid="roadmap-live"
            data-live={subscribed ? "true" : "false"}
            title={subscribed ? "Realtime sync active" : "Realtime sync offline"}
          >
            <span
              aria-hidden
              className={`inline-block size-1.5 rounded-full ${
                subscribed
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-fg/20"
              }`}
            />
            {subscribed ? "LIVE" : "OFFLINE"}
          </span>
        </div>
        <span className="mono-meta-sm text-fg-faint">
          {gridStart.toISOString().slice(0, 10)} →{" "}
          {gridEnd.toISOString().slice(0, 10)}
        </span>
      </div>

      {cards.length === 0 ? (
        <p className="font-serif italic text-fg-faint">
          No roadmap cards yet — set both a start and target date on an epic
          or story to plot it here.
        </p>
      ) : (
        <div
          className="flex border border-hairline rounded-xl overflow-hidden"
          data-testid="roadmap-grid"
        >
          {/* Lane labels (sticky) */}
          <div
            className="shrink-0 border-r border-hairline bg-[color:var(--surface)]"
            style={{ width: LANE_LABEL_WIDTH }}
          >
            <div
              className="border-b border-hairline mono-meta-sm text-fg-faint flex items-end px-3 pb-1"
              style={{ height: HEADER_STRIP_HEIGHT }}
            >
              LANE
            </div>
            {laneLayout.map((ll) => (
              <div
                key={ll.lane.id}
                className="border-b border-hairline px-3 flex flex-col justify-center"
                style={{ height: ll.height }}
              >
                <span className="mono-meta text-fg truncate">
                  {ll.lane.title}
                </span>
                <span className="mono-meta-sm text-fg-faint truncate">
                  {ll.lane.kind === "uncategorized"
                    ? `${ll.placed.length} ORPHANS`
                    : `${ll.placed.length} STORIES`}
                </span>
              </div>
            ))}
          </div>

          {/* Scrollable canvas */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <div
              className="relative"
              style={{ width, height: totalHeight }}
              data-testid="roadmap-canvas"
            >
              {/* Vertical grid lines + header strip labels */}
              <div
                className="absolute inset-x-0 top-0 border-b border-hairline mono-meta-sm text-fg-faint"
                style={{ height: HEADER_STRIP_HEIGHT }}
              >
                {ticks.map((t, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full flex items-end pb-1 pl-1.5"
                    style={{ left: t.x, width: 1 }}
                  >
                    <span className="whitespace-nowrap">
                      {fmtHeader(t.date, zoom)}
                    </span>
                  </div>
                ))}
              </div>
              {/* Vertical grid lines that span full height */}
              {ticks.map((t, i) => (
                <div
                  key={`vl-${i}`}
                  aria-hidden
                  className="absolute top-0 bottom-0 border-l border-hairline/40"
                  style={{ left: t.x }}
                />
              ))}
              {/* Lane horizontal separators */}
              {laneLayout.map((ll) => (
                <div
                  key={`lh-${ll.lane.id}`}
                  className="absolute left-0 right-0 border-b border-hairline"
                  style={{ top: ll.top + ll.height - 1, height: 0 }}
                  aria-hidden
                />
              ))}
              {/* Bars per lane */}
              {laneLayout.map((ll) => {
                const barRowsTop = ll.top + LANE_HEADER_HEIGHT;
                const headerCard = ll.lane.headerCard;
                return (
                  <div key={`bars-${ll.lane.id}`}>
                    {headerCard ? (
                      (() => {
                        const c = headerCard;
                        const x = xForDate(
                          startOfDay(c.startDate),
                          gridStart,
                          ppd,
                        );
                        const w =
                          xForDate(
                            startOfDay(c.targetDate),
                            gridStart,
                            ppd,
                          ) -
                          x +
                          ppd;
                        return (
                          <div
                            className="absolute"
                            style={{
                              left: 0,
                              right: 0,
                              top: barRowsTop,
                              height: ROW_HEIGHT,
                            }}
                          >
                            <RoadmapBar
                              card={c}
                              x={x}
                              width={w}
                              row={0}
                              isHeader
                              onMoveStart={handleMoveStart}
                              onResizeLeftStart={handleResizeLeftStart}
                              onResizeRightStart={handleResizeRightStart}
                              onOpen={handleOpenCard}
                            />
                          </div>
                        );
                      })()
                    ) : null}
                    {(() => {
                      const bodyTop =
                        barRowsTop + (headerCard ? ROW_HEIGHT : 0);
                      const bodyRows = Math.max(1, ll.bodyRows);
                      return (
                        <div
                          className="absolute"
                          style={{
                            left: 0,
                            right: 0,
                            top: bodyTop,
                            height: bodyRows * ROW_HEIGHT,
                          }}
                        >
                          {ll.placed.map((p) => {
                            const c = p.card;
                            const x = xForDate(
                              startOfDay(c.startDate),
                              gridStart,
                              ppd,
                            );
                            const w =
                              xForDate(
                                startOfDay(c.targetDate),
                                gridStart,
                                ppd,
                              ) -
                              x +
                              ppd;
                            return (
                              <RoadmapBar
                                key={c.id}
                                card={c}
                                x={x}
                                width={w}
                                row={p.row}
                                onMoveStart={handleMoveStart}
                                onResizeLeftStart={handleResizeLeftStart}
                                onResizeRightStart={handleResizeRightStart}
                                onOpen={handleOpenCard}
                              />
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              {/* Dependency arrows on top */}
              <DependencyArrows
                links={visibleLinks}
                barCoords={barCoords}
                width={width}
                height={totalHeight}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
