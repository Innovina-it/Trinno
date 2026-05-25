"use client";
/**
 * TimelineChrome — page-level wrapper that mounts the SAME RoadmapHeader +
 * RoadmapFilterBar used on /w/:ws/roadmap, with workspace-only controls
 * hidden via hide-flags. Only diff from the workspace surface is the missing
 * "New card", "?", LIVE/range chip, sprint sub-menu, milestone CRUD, and
 * Critical-path / Auto-reschedule options inside View → all of which depend
 * on a single workspace context that doesn't exist cross-workspace.
 *
 * URL is the source of truth for zoom / lane / view / search / gutter / type
 * filter / overdue / hideCompleted, so the same RoadmapHeader callbacks work
 * unmodified — they write the URL, every band re-reads it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { RoadmapHeader, ZOOMS, LANE_MODES, VIEW_MODES, type LaneMode, type ViewMode } from "@/components/roadmap/roadmap-header";
import { RoadmapFilterBar } from "@/components/roadmap/roadmap-filter-bar";
import { RoadmapMiniMap } from "@/components/roadmap/mini-map";
import { AssigneeFilterRow } from "@/components/filters/assignee-filter-row";
import { useSharedAxis, useSharedDragPpd } from "@/lib/roadmap/shared-axis";
import type { Zoom } from "@/lib/roadmap/dates";
import { dayDiff, pixelsPerDay } from "@/lib/roadmap/dates";
import type { RoadmapCard } from "@/lib/queries/roadmap";

export function TimelineChrome({
  bandIds = [],
  aggregatedCards = [],
}: {
  /** All band IDs currently rendered on the page — used to wire the
   *  collapse-all / expand-all single-click toggle. Pass empty array (or
   *  omit) to hide the button. */
  bandIds?: string[];
  /** All scheduled cards across every visible workspace, mapped to the
   *  RoadmapCard shape. Powers the page-level RoadmapMiniMap. */
  aggregatedCards?: RoadmapCard[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const sharedAxis = useSharedAxis();
  const sharedDragPpd = useSharedDragPpd();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // --- URL-driven state, mirrors RoadmapView's reads ---
  const zoomParam = sp.get("zoom");
  const zoom: Zoom = (ZOOMS as string[]).includes(zoomParam ?? "")
    ? (zoomParam as Zoom)
    : "fit";

  const lanesParam = sp.get("lanes");
  const laneMode: LaneMode = (LANE_MODES as string[]).includes(lanesParam ?? "")
    ? (lanesParam as LaneMode)
    : "sub_board";

  const viewParam = sp.get("view");
  const viewMode: ViewMode = (VIEW_MODES as string[]).includes(viewParam ?? "")
    ? (viewParam as ViewMode)
    : "gantt";

  const gutterOn = sp.get("gutter") === "1";

  const queryParam = sp.get("q") ?? "";
  const [queryDraft, setQueryDraft] = useState(queryParam);
  useEffect(() => setQueryDraft(queryParam), [queryParam]);
  useEffect(() => {
    if (queryDraft === queryParam) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (queryDraft) params.set("q", queryDraft);
      else params.delete("q");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
    // sp intentionally read once per debounce — including it would re-arm
    // the timer on every URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft, queryParam, pathname, router]);

  // --- URL writers shaped like RoadmapView's internal setters ---
  function pushParams(params: URLSearchParams) {
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }
  function setUrlParam(key: string, value: string | null) {
    const params = new URLSearchParams(sp.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    pushParams(params);
  }
  const setZoom = useCallback((next: Zoom) => {
    // Discrete zoom exits any continuous mini-map resize so the new zoom's
    // native ppd takes effect immediately across every band.
    sharedDragPpd?.set(null);
    setUrlParam("zoom", next === "fit" ? null : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, sharedDragPpd]);
  const setLaneMode = useCallback((next: LaneMode) => {
    setUrlParam("lanes", next === "sub_board" ? null : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const setViewMode = useCallback((next: ViewMode) => {
    setUrlParam("view", next === "gantt" ? null : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const toggleGutter = useCallback(() => {
    setUrlParam("gutter", gutterOn ? null : "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gutterOn, sp]);
  const noop = useCallback(() => {}, []);

  // --- Shared axis bindings ---
  const onJumpToDate = useCallback(
    (d: Date) => sharedAxis?.jumpToDate(d),
    [sharedAxis],
  );

  // Range from shared axis powers the (hidden but valid) gridStart/gridEnd
  // props. RoadmapHeader uses them only for the LIVE status row's range
  // chip, which we hide via hideLiveStatus — pass anyway to keep the
  // component well-typed.
  const gridStart = sharedAxis?.range.start ?? new Date();
  const gridEnd = sharedAxis?.range.end ?? new Date();

  // Build a NEW ref-object each time the primary scroller identity changes.
  // RoadmapMiniMap reads scrollerRef.current inside effects whose deps are
  // [scrollerRef], so a stable ref with a mutated `.current` would NOT
  // re-bind the internal scroll listener when the underlying element swaps
  // (e.g. first band collapses → primary becomes the next remaining band).
  // Returning a fresh object on each swap forces those effects to re-run.
  const primaryScrollerRef = useMemo<
    React.RefObject<HTMLDivElement | null>
  >(
    () => ({ current: sharedAxis?.primaryScroller ?? null }),
    [sharedAxis?.primaryScroller],
  );

  // Container width tracking for fit zoom (ppd = width / 180-day window).
  // Re-measures on viewport resize via the same ResizeObserver pattern
  // RoadmapView uses internally.
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = sharedAxis?.primaryScroller;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sharedAxis?.primaryScroller]);

  // Fit zoom divides by a fixed ~6-month focus window so the visible
  // density stays readable even when the shared range extends to cover
  // distant cards. The canvas can still grow past the viewport — users
  // scroll horizontally to reach extensions; Fit no longer compresses
  // every card into a sliver when the data span is large. Must match
  // RoadmapView's Fit computation so mini-map canvasWidth = band scroller
  // scrollWidth.
  const FOCUS_DAYS = 180;
  const totalDays = sharedAxis
    ? Math.max(1, dayDiff(sharedAxis.range.start, sharedAxis.range.end))
    : 1;
  const effectivePpd = useMemo(() => {
    if (sharedDragPpd?.value != null) return sharedDragPpd.value;
    if (zoom !== "fit") return pixelsPerDay(zoom);
    if (containerWidth === 0) return 8; // pre-mount fallback
    return Math.max(2, containerWidth / FOCUS_DAYS);
  }, [zoom, containerWidth, sharedDragPpd?.value]);

  const canvasWidth = totalDays * effectivePpd;

  // --- Collapse-all / Expand-all toggle ---
  const collapsedParam = sp.get("collapsed") ?? "";
  const collapsedSet = useMemo(
    () => new Set(collapsedParam.split(",").filter(Boolean)),
    [collapsedParam],
  );
  const allCollapsed =
    bandIds.length > 0 && bandIds.every((id) => collapsedSet.has(id));
  function toggleCollapseAll() {
    setUrlParam("collapsed", allCollapsed ? null : bandIds.join(","));
  }

  return (
    <div className="space-y-2">
      <RoadmapHeader
        zoom={zoom}
        onSetZoom={setZoom}
        laneMode={laneMode}
        onSetLaneMode={setLaneMode}
        viewMode={viewMode}
        onSetViewMode={setViewMode}
        subscribed={false}
        showCriticalPath={false}
        onToggleCriticalPath={noop}
        autoCascade={false}
        onToggleAutoCascade={noop}
        gutter={gutterOn}
        onToggleGutter={toggleGutter}
        onJumpToDate={onJumpToDate}
        onOpenNewCard={noop}
        queryDraft={queryDraft}
        onQueryDraftChange={setQueryDraft}
        searchInputRef={searchInputRef}
        onOpenShortcuts={noop}
        gridStart={gridStart}
        gridEnd={gridEnd}
        hideNewCard
        hideShortcuts
        hideCriticalPath
        hideAutoCascade
        hideLiveStatus
      />

      {/* Same row /w/:ws/roadmap uses: assignee filter + filter bar (no
          milestone buttons on the cross-WS surface). */}
      <div className="flex items-center gap-2 flex-wrap">
        <AssigneeFilterRow />
        <RoadmapFilterBar sprints={[]} hideSprint />

        {bandIds.length > 0 && (
          <button
            type="button"
            onClick={toggleCollapseAll}
            aria-pressed={allCollapsed}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
            title={
              allCollapsed ? "Expand all workspaces" : "Collapse all workspaces"
            }
          >
            {allCollapsed ? (
              <ChevronsUpDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronsDownUp className="size-3.5" aria-hidden />
            )}
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      {/* Page-level mini-map: same RoadmapMiniMap mounted on /w/:ws/roadmap,
          fed with aggregated cards across every visible band and pointed at
          the first band's scroller via SharedAxis. Scroll-sync mirrors the
          write to every peer scroller, so clicking or dragging the viewport
          rect scrolls all bands together. Drag-resize writes through
          SharedAxis.setDragPpdOverride so every band scales together.

          Gating on `primaryScroller` (not just `sharedAxis`) ensures the
          mini-map mounts AFTER at least one band has registered its scroller,
          so its scroll listener binds to a real element. When every band is
          collapsed, no scrollers exist → mini-map hides. */}
      {sharedAxis?.primaryScroller && aggregatedCards.length > 0 && (
        <div className="hidden md:block">
          <RoadmapMiniMap
            cards={aggregatedCards}
            gridStart={gridStart}
            gridEnd={gridEnd}
            canvasWidth={canvasWidth}
            scrollerRef={primaryScrollerRef}
            zoom={zoom}
            onSetZoom={setZoom}
            effectivePpd={effectivePpd}
            onPpdOverride={sharedDragPpd?.set ?? (noop as (ppd: number | null) => void)}
          />
        </div>
      )}
    </div>
  );
}
