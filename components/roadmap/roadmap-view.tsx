"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  groupByAssignee,
  groupByComponent,
  groupByEpic,
  stackInLane,
  UNCATEGORIZED_LANE_ID,
} from "@/lib/roadmap/layout";
import { getCardStatusKind, type StatusKind } from "@/lib/status";
import { criticalPath, type Link as CritLink } from "@/lib/roadmap/critical-path";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { RoadmapBar } from "./roadmap-bar";
import { PriorityGutter } from "./priority-gutter";
import { DependencyArrows, type BarBox } from "./dependency-arrows";
import { CriticalPathOverlay } from "./critical-path-overlay";
import {
  CascadeConfirmDialog,
  type CascadeAffectedCard,
} from "./cascade-confirm-dialog";
import { SprintOverlay } from "./sprint-overlay";
import { RoadmapNewCardDialog } from "./new-card-dialog";
import { RoadmapFilterBar } from "./roadmap-filter-bar";
import { RoadmapMiniMap } from "./mini-map";
import { RoadmapRowHandle } from "./roadmap-row-handle";
import {
  RoadmapHeader,
  ZOOMS,
  LANE_MODES,
  type LaneMode,
} from "./roadmap-header";
import { parseFilters } from "@/lib/board-filters";
import { useRoadmapDragHarness } from "./use-roadmap-drag-harness";

const ROW_HEIGHT = 36; // 28px bar + 8px gap
const LANE_HEADER_HEIGHT = 28;
const LANE_GAP = 12;
const HEADER_STRIP_HEIGHT = 36;
const LANE_LABEL_WIDTH = 200;

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
  workspaceId,
}: {
  workspaceId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const zoomParam = sp.get("zoom");
  const zoom: Zoom = (ZOOMS as string[]).includes(zoomParam ?? "")
    ? (zoomParam as Zoom)
    : "month";
  const lanesParam = sp.get("lanes");
  const laneMode: LaneMode = (LANE_MODES as string[]).includes(lanesParam ?? "")
    ? (lanesParam as LaneMode)
    : "epic";
  const focusParam = sp.get("focus");
  const queryParam = sp.get("q") ?? "";
  // Plan #16b-γ-G G4 — priority-gutter URL toggle. Default off (param
  // absent); `?gutter=1` turns it on.
  const gutterOn = sp.get("gutter") === "1";

  // A3 — debounced search. URL param `q` is the source of truth, the
  // input is a local mirror that flushes to the URL after 250ms.
  const [queryDraft, setQueryDraft] = useState(queryParam);
  useEffect(() => {
    setQueryDraft(queryParam);
  }, [queryParam]);
  useEffect(() => {
    if (queryDraft === queryParam) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (queryDraft) params.set("q", queryDraft);
      else params.delete("q");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
    // sp is intentionally read once per debounce flush; including it would
    // re-arm the timer on every URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft, queryParam, pathname, router]);
  const queryNorm = queryParam.trim().toLowerCase();

  // A6 — filters parsed from URL (parity with kanban). `sprint` is
  // a roadmap-only addition.
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const sprintFilter = sp.get("sprint") ?? "";

  // A7 — new-card dialog state lifted up so `n` can open it.
  const [newCardOpen, setNewCardOpen] = useState(false);
  // D2 / G3 — when the user clicks (or drag-paints) an empty area of the
  // canvas, prefill the dialog's start_date (and on G3 drag, target_date)
  // with the date(s) under the cursor. G3 also pre-resolves the lane's
  // epic + board so the new card lands in the right slot. Cleared when
  // the dialog closes so subsequent opens (chip / `n`) don't leak stale
  // defaults.
  const [newCardDefaults, setNewCardDefaults] = useState<{
    start?: string;
    target?: string;
    board?: string;
    parent?: string | null;
  } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Plan #16b-α (#6 / #4) — flash an outline ring on the focused bar for
  // 1.5s after mount / focus-param change. Cleared when the timeout fires
  // or the param changes again.
  const [flashFocus, setFlashFocus] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Plan #16b-γ-G G2 — canvas ref for clientY → canvas-local-Y mapping
  // during a bar drag. The lane layout uses canvas-local coords (top: 0
  // is the canvas top, where the header strip lives), so to hit-test
  // which lane the cursor is over we need this rect.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // Ref to the gutter element for clientX hit-testing during drags
  // (consumed by the drag harness).
  const gutterRef = useRef<HTMLDivElement | null>(null);
  // Ref to the lane label panel for row-drag hit-testing (G1).
  const labelPanelRef = useRef<HTMLDivElement | null>(null);

  // Plan #16b-γ-A (#3) — critical-path overlay toggle. Local state only;
  // intentionally not URL-synced because the overlay is a per-session
  // analysis tool, not a shareable view state.
  const [showCriticalPath, setShowCriticalPath] = useState(false);

  // Plan #16b-γ-A (#4) — auto-cascade toggle (per-workspace, persisted in
  // localStorage). When true, a forward target_date drag opens a confirm
  // dialog listing every transitively blocked dependent we'd shift by the
  // same delta. The dialog calls the server action; the originating drag
  // has already persisted on its own.
  const AUTO_CASCADE_KEY = `roadmap:${workspaceId}:autoCascade`;
  const [autoCascade, setAutoCascade] = useState(false);
  const autoCascadeRef = useRef(autoCascade);
  autoCascadeRef.current = autoCascade;
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(AUTO_CASCADE_KEY);
      if (raw === "1") setAutoCascade(true);
    } catch {
      /* ignore */
    }
  }, [AUTO_CASCADE_KEY]);
  const toggleAutoCascade = useCallback(() => {
    setAutoCascade((p) => {
      const next = !p;
      try {
        window.localStorage.setItem(AUTO_CASCADE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [AUTO_CASCADE_KEY]);

  // Cascade dialog state.
  const [cascadeState, setCascadeState] = useState<{
    open: boolean;
    rootCardId: string | null;
    deltaDays: number;
    affected: CascadeAffectedCard[];
  }>({ open: false, rootCardId: null, deltaDays: 0, affected: [] });

  const { subscribed } = useWorkspaceRealtime(workspaceId);

  // Read cards directly from the workspace store, projecting to the
  // RoadmapCard shape the layout helpers expect.
  const storeCards = useWorkspaceStore((s) => s.cards);
  const storeBoards = useWorkspaceStore((s) => s.boards);
  const storeLists = useWorkspaceStore((s) => s.lists);
  const storeLinks = useWorkspaceStore((s) => s.cardLinks);
  const storeSprints = useWorkspaceStore((s) => s.sprints);
  const storeCardMembers = useWorkspaceStore((s) => s.cardMembers);
  const storeProfiles = useWorkspaceStore((s) => s.workspaceProfiles);
  const storeCardComponents = useWorkspaceStore((s) => s.cardComponents);
  const storeComponents = useWorkspaceStore((s) => s.components);
  const patchCardInStore = useWorkspaceStore((s) => s.patchCard);

  // Plan #16b-γ-A (#2) — index card → status kind via list mapping. We
  // recompute when either list mappings or the visible cards change.
  const cardStatusById = useMemo(() => {
    const out = new Map<string, StatusKind | null>();
    for (const c of storeCards) {
      out.set(c.id, getCardStatusKind(c, storeLists));
    }
    return out;
  }, [storeCards, storeLists]);

  // A5 — supporting data for the rich bar tooltip.
  const cardSpById = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const c of storeCards) out.set(c.id, c.storyPoints);
    return out;
  }, [storeCards]);
  const cardSprintNameById = useMemo(() => {
    const sprintsById = new Map(storeSprints.map((s) => [s.id, s.name]));
    const out = new Map<string, string | null>();
    for (const c of storeCards) {
      out.set(c.id, c.sprintId ? sprintsById.get(c.sprintId) ?? null : null);
    }
    return out;
  }, [storeCards, storeSprints]);

  const cards = useMemo<RoadmapCard[]>(() => {
    const boardTitleById = new Map(storeBoards.map((b) => [b.id, b.title]));
    const now = new Date();
    return storeCards
      .filter((c) => {
        if (c.archived) return false;
        if (c.startDate === null || c.targetDate === null) return false;
        if (queryNorm && !c.title.toLowerCase().includes(queryNorm)) {
          return false;
        }
        if (filters.types.length && !filters.types.includes(c.type)) {
          return false;
        }
        if (sprintFilter && c.sprintId !== sprintFilter) return false;
        if (filters.due === "overdue") {
          const due = c.dueDate
            ? c.dueDate instanceof Date
              ? c.dueDate
              : new Date(c.dueDate)
            : null;
          if (!due || due > now || c.dueComplete) return false;
        }
        // Note: filters.labelIds, filters.assignedToMe currently no-op on
        // the roadmap because the workspace snapshot does not yet carry
        // labels / cardMembers. Tracked for the B-batch wrap-up.
        return true;
      })
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
        roadmapOrder: c.roadmapOrder ?? null,
        priority: c.priority ?? null,
      }));
  }, [storeCards, storeBoards, queryNorm, filters, sprintFilter]);

  // Plan #16b-β — count of subtasks per parent that have NO dates set,
  // so we can render an "+N undated subtasks" chip next to the parent bar.
  const undatedSubtaskCountByParent = useMemo(() => {
    const out = new Map<string, number>();
    for (const c of storeCards) {
      if (c.archived) continue;
      if (c.type !== "subtask") continue;
      if (!c.parentCardId) continue;
      if (c.startDate !== null && c.targetDate !== null) continue;
      out.set(c.parentCardId, (out.get(c.parentCardId) ?? 0) + 1);
    }
    return out;
  }, [storeCards]);

  const links = useMemo<RoadmapLink[]>(
    () =>
      storeLinks
        .filter((l) => l.kind === "is_blocked_by")
        .map((l) => ({ fromId: l.fromCardId, toId: l.toCardId })),
    [storeLinks],
  );

  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // Refs for the drag harness — read latest store data inside async drag
  // commits without re-binding listeners.
  const storeCardsRef = useRef(storeCards);
  storeCardsRef.current = storeCards;
  const storeLinksRef = useRef(storeLinks);
  storeLinksRef.current = storeLinks;
  const storeSprintsRef = useRef(storeSprints);
  storeSprintsRef.current = storeSprints;
  // Mirrors the URL `?gutter=1` flag for the drag harness; updated each
  // render so the harness reads the latest without re-binding listeners.
  const gutterOnRef = useRef(gutterOn);
  gutterOnRef.current = gutterOn;

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

  // Plan #16b-β — expanded parent state lifted into RoadmapView.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleParentExpanded = useCallback((parentId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }, []);

  const lanes = useMemo(() => {
    if (laneMode === "assignee") {
      return groupByAssignee(cards, storeCardMembers, storeProfiles);
    }
    if (laneMode === "component") {
      return groupByComponent(cards, storeCardComponents, storeComponents);
    }
    return groupByEpic(cards);
  }, [
    laneMode,
    cards,
    storeCardMembers,
    storeProfiles,
    storeCardComponents,
    storeComponents,
  ]);

  // Per-lane stacking + total height. Each entry tracks where in the
  // canvas its body bars start, and pre-computes per-row offsets for any
  // expanded subtask groups so the bar renderer can place children
  // beneath the parent without re-doing layout work.
  const laneLayout = useMemo(() => {
    let yCursor = HEADER_STRIP_HEIGHT;
    return lanes.map((lane) => {
      const placed = stackInLane(lane.cards);
      const rowsCount =
        placed.length === 0 ? 0 : Math.max(...placed.map((p) => p.row + 1));
      const headerRows = lane.headerCard ? 1 : 0;
      const bodyRows = Math.max(rowsCount, headerRows);
      // Compute extra rows added by expanded subtask groups. Header card
      // gets its own row, body cards group by stack row — within a row we
      // take the max children-count so overlapping expansions don't break
      // layout.
      let extraRows = 0;
      const expandedExtraByParent = new Map<string, number>();
      const headerExpansion =
        lane.headerCard && expandedParents.has(lane.headerCard.id)
          ? lane.subtaskRowsByParent[lane.headerCard.id]?.length ?? 0
          : 0;
      if (headerExpansion > 0 && lane.headerCard)
        expandedExtraByParent.set(lane.headerCard.id, headerExpansion);
      extraRows += headerExpansion;
      const maxByStackRow = new Map<number, number>();
      for (const p of placed) {
        if (!expandedParents.has(p.card.id)) continue;
        const rows = lane.subtaskRowsByParent[p.card.id];
        if (!rows || rows.length === 0) continue;
        expandedExtraByParent.set(p.card.id, rows.length);
        const cur = maxByStackRow.get(p.row) ?? 0;
        if (rows.length > cur) maxByStackRow.set(p.row, rows.length);
      }
      for (const v of maxByStackRow.values()) extraRows += v;
      const height =
        LANE_HEADER_HEIGHT +
        (Math.max(1, bodyRows) + extraRows) * ROW_HEIGHT +
        LANE_GAP;
      const top = yCursor;
      yCursor += height;
      return {
        lane,
        placed,
        top,
        height,
        headerRows,
        bodyRows,
        expandedExtraByParent,
      };
    });
  }, [lanes, expandedParents]);

  // Plan #16b-γ-G G2 — bar-drag vertical hit-testing reads the latest
  // laneLayout without re-binding the pointermove callback (which would
  // drop the active window listeners on each frame).
  const laneLayoutRef = useRef(laneLayout);
  laneLayoutRef.current = laneLayout;

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

  // ---- Lane mode toggle (URL-synced; default "epic" stays absent from URL) ----
  function setLaneMode(next: LaneMode) {
    const params = new URLSearchParams(sp.toString());
    if (next === "epic") params.delete("lanes");
    else params.set("lanes", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Plan #16b-γ-G G4 — priority-gutter toggle (URL-synced; default off).
  function toggleGutter() {
    const params = new URLSearchParams(sp.toString());
    if (gutterOn) params.delete("gutter");
    else params.set("gutter", "1");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Plan #16b-γ-G aggregate review I2 — drag harness extracted out of
  // RoadmapView. Owns all five drag systems (bar, paint, chip, row,
  // auto-scroll), all snap state, and Esc cancellation. RoadmapView is
  // orchestration + render only; it forwards refs the harness needs to
  // read (without re-binding listeners) and provides a callback for
  // the cascade dialog mount and the new-card dialog open.
  const onCascadeNeeded = useCallback(
    (info: {
      rootCardId: string;
      deltaDays: number;
      affected: CascadeAffectedCard[];
    }) => {
      setCascadeState({
        open: true,
        rootCardId: info.rootCardId,
        deltaDays: info.deltaDays,
        affected: info.affected,
      });
    },
    [],
  );
  const onOpenNewCardDialog = useCallback(
    (
      defaults: {
        start?: string;
        target?: string;
        board?: string;
        parent?: string | null;
      } | null,
    ) => {
      setNewCardDefaults(defaults);
      setNewCardOpen(true);
    },
    [],
  );
  const onOpenCard = useCallback(
    (cardId: string, boardId: string) => {
      router.push(`/b/${boardId}/c/${cardId}`);
    },
    [router],
  );

  const drag = useRoadmapDragHarness({
    ppd,
    gridStart,
    LANE_HEADER_HEIGHT,
    ROW_HEIGHT,
    HEADER_STRIP_HEIGHT,
    laneLayout,
    laneLayoutRef,
    cardsRef,
    storeCardsRef,
    storeLinksRef,
    storeSprintsRef,
    scrollerRef,
    canvasRef,
    labelPanelRef,
    gutterRef,
    patchCardInStore,
    laneMode,
    gutterOnRef,
    autoCascadeRef,
    onCascadeNeeded,
    onOpenNewCardDialog,
    onOpenCard,
  });

  // Bar-drag entry-point wrappers — RoadmapBar accepts per-mode handlers
  // shaped (e, cardId) => void, the harness exposes a single (mode, e,
  // cardId) entry. Wrapping here keeps the harness API symmetric across
  // modes without leaking three identical exports.
  const handleMoveStart = useCallback(
    (e: React.PointerEvent, cardId: string) =>
      drag.beginBarDrag("move", e, cardId),
    [drag],
  );
  const handleResizeLeftStart = useCallback(
    (e: React.PointerEvent, cardId: string) =>
      drag.beginBarDrag("resize-left", e, cardId),
    [drag],
  );
  const handleResizeRightStart = useCallback(
    (e: React.PointerEvent, cardId: string) =>
      drag.beginBarDrag("resize-right", e, cardId),
    [drag],
  );

  // Plan #16b-γ-Gantt-Master Group C (C5) — jump-to-date control.
  // Centers the given date in the scroller viewport, clamped to the
  // scrollable range. Smooth scroll for nicer UX.
  const jumpToDate = useCallback(
    (target: Date) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const x = xForDate(startOfDay(target), gridStart, ppd);
      const desired = x - scroller.clientWidth / 2;
      const max = scroller.scrollWidth - scroller.clientWidth;
      const left = Math.max(0, Math.min(max, desired));
      scroller.scrollTo({ left, behavior: "smooth" });
    },
    [gridStart, ppd],
  );


  // Plan #16b-α (#17) — persist zoom + scroll-x per workspace in
  // localStorage. On mount we read the saved viewport: the zoom is
  // applied via URL replace (so it stays bookmarkable) UNLESS the URL
  // already has an explicit `?zoom=` (URL wins), and the scrollX is
  // applied to the scroller after first paint. Subsequent zoom changes
  // and scroll events write back debounced.
  const VIEWPORT_KEY = `roadmap:${workspaceId}:viewport`;
  const hydratedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (typeof window === "undefined") return;
    let saved: { zoom?: Zoom; scrollX?: number } | null = null;
    try {
      const raw = window.localStorage.getItem(VIEWPORT_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
    if (!saved) return;
    // Apply saved zoom only if URL is silent on the matter.
    if (saved.zoom && !zoomParam && (ZOOMS as string[]).includes(saved.zoom)) {
      const params = new URLSearchParams(sp.toString());
      params.set("zoom", saved.zoom);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    // Apply scrollX after first paint.
    if (typeof saved.scrollX === "number") {
      requestAnimationFrame(() => {
        if (scrollerRef.current) {
          scrollerRef.current.scrollLeft = saved!.scrollX!;
        }
      });
    }
    // Note: we intentionally don't include sp / pathname / router in deps —
    // hydration runs exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [VIEWPORT_KEY]);

  // Persist zoom whenever it changes (URL-driven).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hydratedRef.current) return;
    try {
      const raw = window.localStorage.getItem(VIEWPORT_KEY);
      const cur = raw ? JSON.parse(raw) : {};
      cur.zoom = zoom;
      window.localStorage.setItem(VIEWPORT_KEY, JSON.stringify(cur));
    } catch {
      /* ignore */
    }
  }, [zoom, VIEWPORT_KEY]);

  // Debounced scroll persistence.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    function onScroll() {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          const raw = window.localStorage.getItem(VIEWPORT_KEY);
          const cur = raw ? JSON.parse(raw) : {};
          cur.scrollX = scroller!.scrollLeft;
          window.localStorage.setItem(VIEWPORT_KEY, JSON.stringify(cur));
        } catch {
          /* ignore */
        }
      }, 200);
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [VIEWPORT_KEY]);

  // Plan #16b-α (#4) — when the URL carries `?focus=<cardId>`, scroll the
  // matching bar into view and flash a 1.5s outline ring. We re-run when the
  // param changes OR when the bar list lands (cards in store) so deep-links
  // still focus once data arrives. The card is a regular dependency so we
  // don't require an explicit "data ready" signal.
  useEffect(() => {
    if (!focusParam) return;
    const exists = cards.some((c) => c.id === focusParam);
    if (!exists) return;
    // rAF gives layout one tick to settle so scrollIntoView lands correctly.
    const raf = requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const bar = scroller.querySelector<HTMLElement>(
        `[data-roadmap-focus="${focusParam}"]`,
      );
      if (bar) {
        bar.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      }
      setFlashFocus(focusParam);
    });
    const timer = setTimeout(() => setFlashFocus(null), 1500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [focusParam, cards]);

  // Keep the dependency-arrows links list filtered to visible bars only.
  const visibleLinks = useMemo(
    () =>
      links.filter(
        (l) => barCoords.has(l.fromId) && barCoords.has(l.toId),
      ),
    [links, barCoords],
  );

  // Plan #16b-γ-A (#3) — compute longest-path set client-side. Cards
  // already carry start/target dates; links from the workspace store are
  // filtered to only `is_blocked_by` rows by `criticalPath` itself.
  const criticalSet = useMemo(() => {
    if (!showCriticalPath) return new Set<string>();
    const cardSlim = cards.map((c) => ({
      id: c.id,
      startDate: c.startDate,
      targetDate: c.targetDate,
    }));
    const allLinks: CritLink[] = storeLinks.map((l) => ({
      from: l.fromCardId,
      to: l.toCardId,
      kind: l.kind,
    }));
    return criticalPath(cardSlim, allLinks).critical;
  }, [showCriticalPath, cards, storeLinks]);

  // A7 — global keyboard shortcuts. Ignored while typing in an input,
  // textarea, or contenteditable surface (except `Esc`, which is a
  // universal escape hatch and clears the search input).
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = isTypingTarget(e.target);
      if (e.key === "Escape") {
        // Plan #16b-γ-G I2 — drag harness owns chip/paint/row Esc
        // cancellation. Order inside the harness mirrors the prior
        // priority (chip → paint → row), so chip-cancel still beats
        // search-clear when both apply.
        if (drag.cancelActiveDrag()) {
          e.preventDefault();
          return;
        }
        if (queryDraft) {
          setQueryDraft("");
          e.preventDefault();
          return;
        }
        if (newCardOpen || shortcutsOpen) {
          // base-ui Dialog handles Esc itself; let it through.
          return;
        }
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNewCardOpen(true);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        const idx = ZOOMS.indexOf(zoom);
        const nextIdx = Math.min(ZOOMS.length - 1, idx + 1);
        if (nextIdx !== idx) {
          e.preventDefault();
          setZoom(ZOOMS[nextIdx]);
        }
        return;
      }
      if (e.key === "-" || e.key === "_") {
        const idx = ZOOMS.indexOf(zoom);
        const nextIdx = Math.max(0, idx - 1);
        if (nextIdx !== idx) {
          e.preventDefault();
          setZoom(ZOOMS[nextIdx]);
        }
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        e.preventDefault();
        const step = e.shiftKey ? scroller.clientWidth : 80;
        scroller.scrollBy({
          left: e.key === "ArrowLeft" ? -step : step,
          behavior: "smooth",
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // setZoom is a stable function defined in this scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft, newCardOpen, shortcutsOpen, zoom, drag]);

  return (
    <div
      data-testid="roadmap-view"
      data-workspace-id={workspaceId}
      className="space-y-4"
    >
      <RoadmapHeader
        zoom={zoom}
        onSetZoom={setZoom}
        laneMode={laneMode}
        onSetLaneMode={setLaneMode}
        subscribed={subscribed}
        showCriticalPath={showCriticalPath}
        onToggleCriticalPath={() => setShowCriticalPath((p) => !p)}
        autoCascade={autoCascade}
        onToggleAutoCascade={toggleAutoCascade}
        gutter={gutterOn}
        onToggleGutter={toggleGutter}
        onJumpToDate={jumpToDate}
        onOpenNewCard={() => setNewCardOpen(true)}
        onChipDragStart={drag.onChipDragStart}
        queryDraft={queryDraft}
        onQueryDraftChange={setQueryDraft}
        searchInputRef={searchInputRef}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        gridStart={gridStart}
        gridEnd={gridEnd}
      />
      <RoadmapFilterBar />

      {cards.length > 0 && (
        <RoadmapMiniMap
          cards={cards}
          gridStart={gridStart}
          gridEnd={gridEnd}
          canvasWidth={width}
          scrollerRef={scrollerRef}
        />
      )}

      {cards.length === 0 ? (
        // Plan #16b-γ-C (#7) — explicit empty-state with editorial
        // CTA copy. We layer it inside the same data-testid="roadmap-view"
        // wrapper so existing E2E selectors still match.
        <div
          className="relative min-h-[40vh] grid place-items-center text-center"
          data-testid="roadmap-empty"
        >
          <div className="space-y-3 max-w-md">
            {queryNorm && (
              <p className="mono-meta-sm text-fg-faint">
                NO MATCHES FOR &quot;{queryParam}&quot;
              </p>
            )}
            <p className="serif-display text-4xl">Nothing scheduled.</p>
            <p className="text-sm text-fg-muted">
              Set a start and target date on any card. Or drag the
              <span className="mono-meta-sm text-fg mx-1">+ NEW CARD</span>
              chip onto the timeline.
            </p>
          </div>
        </div>
      ) : (
        <>
          {lanes.length === 1 &&
            lanes[0].id === UNCATEGORIZED_LANE_ID &&
            lanes[0].cards.length === 0 && (
              <div
                className="mx-auto max-w-2xl py-8 text-center text-fg-faint"
                data-testid="roadmap-empty-unassigned-banner"
              >
                Mark a card as <span className="chip mono-meta-sm">Epic</span> to organize work into kanbans.
              </div>
            )}
        <div
          className="flex border border-hairline rounded-xl overflow-hidden"
          data-testid="roadmap-grid"
        >
          {/* Plan #16b-γ-G G4 — priority gutter as its own column to the
              LEFT of the lane-label panel. Visible only when toggled on;
              bars are tinted by priority regardless. The ref lets the
              drag harness hit-test pointermove against gutter bounds. */}
          {gutterOn && (
            <PriorityGutter
              ref={gutterRef}
              height={HEADER_STRIP_HEIGHT + totalHeight}
              hoveredBand={drag.hoveredGutterBand}
            />
          )}
          {/* Lane labels (sticky) */}
          <div
            ref={labelPanelRef}
            className="shrink-0 border-r border-hairline bg-[color:var(--surface)] relative"
            style={{ width: LANE_LABEL_WIDTH }}
          >
            <div
              className="border-b border-hairline mono-meta-sm text-fg-faint flex items-end px-3 pb-1"
              style={{ height: HEADER_STRIP_HEIGHT }}
            >
              LANE
            </div>
            {laneLayout.map((ll) => {
              const epicHeader = ll.lane.headerCard;
              const draggable = laneMode === "epic" && epicHeader !== null;
              const isDragging =
                drag.rowDragGhost !== null &&
                epicHeader?.id === drag.rowDragGhost.cardId;
              const count = ll.placed.length;
              const meta =
                ll.lane.kind === "uncategorized"
                  ? `${count} ${count === 1 ? "ORPHAN" : "ORPHANS"}`
                  : ll.lane.kind === "assignee" || ll.lane.kind === "component"
                    ? `${count} ${count === 1 ? "CARD" : "CARDS"}`
                    : `${count} ${count === 1 ? "STORY" : "STORIES"}`;
              return (
                <div
                  key={ll.lane.id}
                  className={`group relative border-b border-hairline pl-7 pr-3 flex flex-col justify-center ${
                    isDragging ? "opacity-40" : ""
                  }`}
                  style={{ height: ll.height, minHeight: 64 }}
                  data-testid="roadmap-lane-row"
                  data-card-id={epicHeader?.id}
                >
                  {draggable && epicHeader && (
                    <RoadmapRowHandle
                      cardId={epicHeader.id}
                      onDragStart={drag.beginRowDrag}
                    />
                  )}
                  {epicHeader ? (
                    <Link
                      href={`/w/${workspaceId}/e/${epicHeader.id}`}
                      className="mono-meta text-fg truncate hover:underline focus:outline-none focus:underline"
                      data-testid="lane-epic-header-link"
                      data-card-id={epicHeader.id}
                    >
                      {ll.lane.title}
                    </Link>
                  ) : (
                    <span className="mono-meta text-fg truncate">
                      {ll.lane.title}
                    </span>
                  )}
                  <span className="mono-meta-sm text-fg-faint truncate">
                    {meta}
                  </span>
                </div>
              );
            })}
            {/* Plan #16b-γ-G G1 — drop indicator overlay during a row
                drag. Renders a thin line at the resolved insertion
                point. */}
            {drag.rowDragGhost !== null && (() => {
              const lanes = drag.rowDragLanesRef.current;
              if (lanes.length === 0) return null;
              const idx = drag.rowDragGhost.insertIndex;
              const indicatorY =
                idx >= lanes.length
                  ? lanes[lanes.length - 1].top + lanes[lanes.length - 1].height
                  : lanes[idx].top;
              return (
                <div
                  aria-hidden
                  data-testid="roadmap-row-drop-indicator"
                  className="absolute left-0 right-0 h-[2px] bg-fg pointer-events-none"
                  style={{ top: indicatorY - 1 }}
                />
              );
            })()}
          </div>

          {/* Scrollable canvas */}
          <div
            ref={scrollerRef}
            className="flex-1 overflow-x-auto overflow-y-hidden"
            data-testid="roadmap-scroller"
          >
            <div
              ref={canvasRef}
              className="relative"
              style={{ width, height: totalHeight }}
              data-testid="roadmap-canvas"
              onPointerDown={drag.onCanvasEmptyPointerDown}
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
              {/* Today marker — vertical 1px line at today's x. Rendered
                  beneath bars (z-default) so a bar covering today still
                  shows the line through hairline transparency. */}
              {(() => {
                const todayX = xForDate(startOfDay(now), gridStart, ppd);
                if (todayX < 0 || todayX > width) return null;
                return (
                  <div
                    aria-hidden
                    data-testid="roadmap-today-marker"
                    className="absolute top-0 bottom-0 w-px bg-fg/30 pointer-events-none"
                    style={{ left: todayX }}
                  >
                    <span
                      className="absolute -translate-x-1/2 mono-meta-sm text-fg-faint bg-[color:var(--popover)] px-1.5 py-0.5 rounded-md border border-hairline-hi"
                      style={{ top: 4, left: 0 }}
                    >
                      TODAY
                    </span>
                  </div>
                );
              })()}
              {/* Lane horizontal separators */}
              {laneLayout.map((ll) => (
                <div
                  key={`lh-${ll.lane.id}`}
                  className="absolute left-0 right-0 border-b border-hairline"
                  style={{ top: ll.top + ll.height - 1, height: 0 }}
                  aria-hidden
                />
              ))}
              {/* Plan #16b-γ-G G2 — destination-lane highlight while a
                  bar is being dragged across lanes. Only renders when
                  the cursor is over a lane different from the source.
                  Sits below the bar layer (rendered next) so the bar
                  remains fully readable while it crosses. */}
              {drag.dragHoverLaneId !== null &&
                laneLayout
                  .filter((ll) => ll.lane.id === drag.dragHoverLaneId)
                  .map((ll) => (
                    <div
                      key={`lt-${ll.lane.id}`}
                      data-testid="roadmap-lane-target"
                      data-lane-id={ll.lane.id}
                      aria-hidden
                      className="absolute left-0 right-0 ring-1 ring-fg/40 bg-fg/[0.04] pointer-events-none"
                      style={{ top: ll.top, height: ll.height }}
                    />
                  ))}
              {/* Plan #16b-γ-G G7 — destination-lane highlight while the
                  user drags the header NEW CARD chip over the canvas.
                  Reuses the same `roadmap-lane-target` testid + ring
                  styling as G2 reparent for a consistent affordance. */}
              {drag.chipHoverLaneId !== null &&
                laneLayout
                  .filter((ll) => ll.lane.id === drag.chipHoverLaneId)
                  .map((ll) => (
                    <div
                      key={`ct-${ll.lane.id}`}
                      data-testid="roadmap-lane-target"
                      data-lane-id={ll.lane.id}
                      aria-hidden
                      className="absolute left-0 right-0 ring-1 ring-fg/40 bg-fg/[0.04] pointer-events-none"
                      style={{ top: ll.top, height: ll.height }}
                    />
                  ))}
              {/* Weekend shading (Sat + Sun). Skipped on quarter zoom
                  (8 px/day) where 16-px stripes clutter without informing. */}
              {zoom !== "quarter" &&
                (() => {
                  const stripes: React.ReactNode[] = [];
                  // Find first Saturday >= gridStart. UTC day: 0=Sun..6=Sat.
                  const startDay = gridStart.getUTCDay();
                  const daysToFirstSat = (6 - startDay + 7) % 7;
                  let cur = addDays(gridStart, daysToFirstSat);
                  while (cur.getTime() < gridEnd.getTime()) {
                    const x = xForDate(cur, gridStart, ppd);
                    stripes.push(
                      <div
                        key={`we-${cur.toISOString()}`}
                        data-testid="roadmap-weekend"
                        aria-hidden
                        className="absolute pointer-events-none bg-fg/[0.03]"
                        style={{
                          left: x,
                          top: HEADER_STRIP_HEIGHT,
                          bottom: 0,
                          width: 2 * ppd,
                        }}
                      />,
                    );
                    cur = addDays(cur, 7);
                  }
                  return <>{stripes}</>;
                })()}
              {/* Today vertical indicator line */}
              {(() => {
                const today = startOfDay(new Date());
                if (today < gridStart || today > gridEnd) return null;
                const todayX = xForDate(today, gridStart, ppd);
                return (
                  <div
                    data-testid="roadmap-today-line"
                    aria-hidden
                    className="absolute pointer-events-none border-l border-fg/50"
                    style={{
                      left: todayX,
                      top: HEADER_STRIP_HEIGHT,
                      bottom: 0,
                      width: 1,
                    }}
                    title="Today"
                  />
                );
              })()}
              {/* Plan #16b-γ-G G6 polish — visual snap guide. Drawn
                  while a drag is in progress and a snap candidate is
                  within the 4-day window. Suppressed when Alt is held
                  (the release will skip snap). Sits between today-line
                  and the bar layer so labels read above weekend
                  stripes but below dragged bars. */}
              {drag.snapPreview &&
                (() => {
                  const x = xForDate(drag.snapPreview.date, gridStart, ppd);
                  return (
                    <>
                      <div
                        data-testid="roadmap-snap-guide"
                        data-snap-kind={drag.snapPreview.kind}
                        aria-hidden
                        className="absolute pointer-events-none border-l border-fg/70"
                        style={{
                          left: x,
                          top: HEADER_STRIP_HEIGHT,
                          bottom: 0,
                          width: 1,
                        }}
                      />
                      <div
                        data-testid="roadmap-snap-label"
                        data-snap-kind={drag.snapPreview.kind}
                        aria-hidden
                        className="absolute pointer-events-none mono-meta-sm text-fg-muted bg-[color:var(--surface-strong)] px-1.5 py-0.5 rounded chip"
                        style={{
                          left: x + 4,
                          top: HEADER_STRIP_HEIGHT + 4,
                        }}
                      >
                        → {drag.snapPreview.label}
                      </div>
                    </>
                  );
                })()}
              {/* Sprint overlay — 4px stripe under date ticks. */}
              <SprintOverlay
                zoom={zoom}
                gridStart={gridStart}
                gridEnd={gridEnd}
                headerHeight={HEADER_STRIP_HEIGHT}
              />
              {/* Bars per lane */}
              {laneLayout.map((ll) => {
                const barRowsTop = ll.top + LANE_HEADER_HEIGHT;
                const headerCard = ll.lane.headerCard;
                // We walk the lane's stack rows in order. Within each
                // stack row we render every bar at the same y, then if
                // ANY of those bars is expanded we render their subtask
                // rows beneath, before advancing to the next stack row.
                // This preserves the original parallel stacking when no
                // bars are expanded and gracefully extends it when they
                // are.
                const renderedBars: React.ReactNode[] = [];
                let rowCursor = 0;

                const renderSubtaskRows = (parentCard: RoadmapCard) => {
                  const subRows =
                    ll.lane.subtaskRowsByParent[parentCard.id] ?? [];
                  if (!expandedParents.has(parentCard.id)) return 0;
                  if (subRows.length === 0) return 0;
                  subRows.forEach((rowCards, rowIdx) => {
                    renderedBars.push(
                      <div
                        key={`subrow-${parentCard.id}-${rowIdx}`}
                        className="absolute"
                        style={{
                          left: 0,
                          right: 0,
                          top: barRowsTop + (rowCursor + rowIdx) * ROW_HEIGHT,
                          height: ROW_HEIGHT,
                        }}
                      >
                        {rowCards.map((p) => {
                          const sc = p.card;
                          const sx = xForDate(
                            startOfDay(sc.startDate),
                            gridStart,
                            ppd,
                          );
                          const sw =
                            xForDate(
                              startOfDay(sc.targetDate),
                              gridStart,
                              ppd,
                            ) -
                            sx +
                            ppd;
                          return (
                            <div
                              key={sc.id}
                              className="absolute h-3 rounded-sm border border-fg/25 bg-fg/8 hover:border-fg/50 transition-colors flex items-center px-1.5 cursor-pointer select-none"
                              style={{
                                left: sx + 16,
                                width: Math.max(sw - 16, 8),
                                top: 12,
                              }}
                              data-card-id={sc.id}
                              data-testid="roadmap-subtask-bar"
                              onClick={() => onOpenCard(sc.id, sc.boardId)}
                              title={`${sc.title} — ${sc.startDate
                                .toISOString()
                                .slice(0, 10)} → ${sc.targetDate
                                .toISOString()
                                .slice(0, 10)}`}
                            >
                              <span className="text-[10px] text-fg-muted truncate">
                                {sc.title}
                              </span>
                            </div>
                          );
                        })}
                      </div>,
                    );
                  });
                  return subRows.length;
                };

                const renderParentBar = (
                  parentCard: RoadmapCard,
                  isHeader: boolean,
                ) => {
                  const c = parentCard;
                  const x = xForDate(startOfDay(c.startDate), gridStart, ppd);
                  const w =
                    xForDate(startOfDay(c.targetDate), gridStart, ppd) -
                    x +
                    ppd;
                  const expanded = expandedParents.has(c.id);
                  const subRows =
                    ll.lane.subtaskRowsByParent[c.id] ?? [];
                  const hasChildren = subRows.length > 0;
                  const undated = undatedSubtaskCountByParent.get(c.id) ?? 0;
                  return (
                    <div
                      key={`bar-${c.id}`}
                      className="absolute"
                      style={{
                        left: 0,
                        right: 0,
                        top: 0,
                        height: ROW_HEIGHT,
                      }}
                    >
                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleParentExpanded(c.id)}
                          aria-label={
                            expanded
                              ? `Collapse subtasks of ${c.title}`
                              : `Expand subtasks of ${c.title}`
                          }
                          aria-expanded={expanded}
                          data-testid="roadmap-parent-toggle"
                          data-card-id={c.id}
                          className="absolute top-1.5 size-5 rounded-md border border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg flex items-center justify-center"
                          style={{ left: Math.max(0, x - 22) }}
                        >
                          <ChevronDown
                            className={`size-3 transition-transform ${
                              expanded ? "" : "-rotate-90"
                            }`}
                          />
                        </button>
                      )}
                      <RoadmapBar
                        card={c}
                        x={x}
                        width={w}
                        row={0}
                        isHeader={isHeader}
                        focused={flashFocus === c.id}
                        status={cardStatusById.get(c.id) ?? null}
                        storyPoints={cardSpById.get(c.id) ?? null}
                        sprintName={cardSprintNameById.get(c.id) ?? null}
                        onMoveStart={handleMoveStart}
                        onResizeLeftStart={handleResizeLeftStart}
                        onResizeRightStart={handleResizeRightStart}
                        onOpen={onOpenCard}
                      />
                      {undated > 0 && (
                        <span
                          className="absolute top-2 chip mono-meta-sm"
                          style={{ left: x + w + 6 }}
                          data-testid="roadmap-undated-subtasks"
                          data-card-id={c.id}
                        >
                          +{undated} UNDATED
                        </span>
                      )}
                    </div>
                  );
                };

                // Render header card first (always row 0 of the lane).
                if (headerCard) {
                  renderedBars.push(
                    <div
                      key={`header-row-${ll.lane.id}`}
                      className="absolute"
                      style={{
                        left: 0,
                        right: 0,
                        top: barRowsTop + rowCursor * ROW_HEIGHT,
                        height: ROW_HEIGHT,
                      }}
                    >
                      {renderParentBar(headerCard, true)}
                    </div>,
                  );
                  rowCursor += 1;
                  rowCursor += renderSubtaskRows(headerCard);
                }

                // Render body rows, grouping placed cards by their .row.
                const cardsByRow = new Map<number, RoadmapCard[]>();
                let maxRow = -1;
                for (const p of ll.placed) {
                  const arr = cardsByRow.get(p.row) ?? [];
                  arr.push(p.card);
                  cardsByRow.set(p.row, arr);
                  if (p.row > maxRow) maxRow = p.row;
                }
                for (let r = 0; r <= maxRow; r++) {
                  const rowCards = cardsByRow.get(r) ?? [];
                  if (rowCards.length === 0) {
                    rowCursor += 1;
                    continue;
                  }
                  const stackRowTop =
                    barRowsTop + rowCursor * ROW_HEIGHT;
                  renderedBars.push(
                    <div
                      key={`stackrow-${ll.lane.id}-${r}`}
                      className="absolute"
                      style={{
                        left: 0,
                        right: 0,
                        top: stackRowTop,
                        height: ROW_HEIGHT,
                      }}
                    >
                      {rowCards.map((c) => renderParentBar(c, false))}
                    </div>,
                  );
                  rowCursor += 1;
                  // Stack subtask rows for any expanded parents in this row.
                  let extraInRow = 0;
                  for (const c of rowCards) {
                    const added = renderSubtaskRows(c);
                    if (added > extraInRow) extraInRow = added;
                  }
                  rowCursor += extraInRow;
                }

                return (
                  <div key={`bars-${ll.lane.id}`}>{renderedBars}</div>
                );
              })}
              {/* Critical-path overlay sits between bars and arrows. */}
              {showCriticalPath && (
                <CriticalPathOverlay
                  critical={criticalSet}
                  links={visibleLinks}
                  barCoords={barCoords}
                  width={width}
                  height={totalHeight}
                />
              )}
              {/* Dependency arrows on top */}
              <DependencyArrows
                links={visibleLinks}
                barCoords={barCoords}
                width={width}
                height={totalHeight}
              />
              {/* Plan #16b-γ-G G3 — drag-paint ghost. Renders ABOVE every
                  other canvas child while the user is painting; cleared
                  on pointerup or Esc. `pointer-events-none` so it never
                  swallows the move events that drive its own update. */}
              {drag.paintRect && (
                <div
                  data-testid="roadmap-paint-ghost"
                  aria-hidden
                  className="absolute pointer-events-none border-2 border-dashed border-fg/40 bg-fg/[0.05]"
                  style={{
                    left: drag.paintRect.left,
                    top: drag.paintRect.top,
                    width: drag.paintRect.width,
                    height: drag.paintRect.height,
                  }}
                />
              )}
            </div>
          </div>
        </div>
        </>
      )}
      <CascadeConfirmDialog
        open={cascadeState.open}
        onOpenChange={(next) =>
          setCascadeState((s) => ({ ...s, open: next }))
        }
        rootCardId={cascadeState.rootCardId}
        deltaDays={cascadeState.deltaDays}
        affectedCards={cascadeState.affected}
      />
      <RoadmapNewCardDialog
        open={newCardOpen}
        onOpenChange={(next) => {
          setNewCardOpen(next);
          if (!next) setNewCardDefaults(null);
        }}
        defaultStart={newCardDefaults?.start}
        defaultTarget={newCardDefaults?.target}
        defaultBoard={newCardDefaults?.board}
        defaultParent={newCardDefaults?.parent ?? null}
      />
      {/* Plan #16b-γ-G G7 — translucent floating chip that follows the
          cursor while the user drags the header NEW CARD chip. Uses
          fixed positioning + raw clientX/clientY so it tracks the
          cursor regardless of viewport scroll. pointer-events-none so
          it never swallows the move events that drive its own update. */}
      {drag.chipGhost && (
        <div
          data-testid="roadmap-chip-ghost"
          aria-hidden
          className="fixed pointer-events-none chip mono-meta-sm bg-fg/10 ring-1 ring-fg/40 z-50"
          style={{
            left: drag.chipGhost.clientX + 12,
            top: drag.chipGhost.clientY + 12,
          }}
        >
          + NEW CARD
        </div>
      )}
      <RoadmapShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
  );
}

function RoadmapShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="roadmap-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>ROADMAP</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="mono-meta text-fg-faint">/</dt>
          <dd className="text-fg">Focus search</dd>
          <dt className="mono-meta text-fg-faint">Esc</dt>
          <dd className="text-fg">Clear search / close menus</dd>
          <dt className="mono-meta text-fg-faint">+ / −</dt>
          <dd className="text-fg">Zoom in / out</dd>
          <dt className="mono-meta text-fg-faint">← / →</dt>
          <dd className="text-fg">Scroll the timeline</dd>
          <dt className="mono-meta text-fg-faint">n</dt>
          <dd className="text-fg">New card</dd>
          <dt className="mono-meta text-fg-faint">?</dt>
          <dd className="text-fg">Show this list</dd>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
