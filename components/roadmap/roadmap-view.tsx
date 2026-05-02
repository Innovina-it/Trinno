"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
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
} from "@/lib/roadmap/layout";
import { getCardStatusKind, type StatusKind } from "@/lib/status";
import { criticalPath, type Link as CritLink } from "@/lib/roadmap/critical-path";
import { updateCard, reorderRoadmapRow } from "@/actions/cards";
import { errorBus } from "@/lib/errors/error-bus";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { RoadmapBar } from "./roadmap-bar";
import { PriorityGutter, PRIORITIES } from "./priority-gutter";
import type { CardPriority } from "@/components/board/card/priority-picker";
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
  // Plan #16b-γ-G G2 — vertical lane-crossing reparent. Both fields are
  // populated only in epic mode; in assignee/component mode vertical
  // movement does not change the bar's parent so we leave them null.
  sourceLaneId: string | null;
  currentLaneId: string | null;
  // Plan #16b-γ-G G4 — priority-gutter mode. When the cursor enters the
  // gutter region during a `move` drag (and `gutterOn === true`), this
  // captures the band the cursor is currently over. While set, the
  // pointermove handler does NOT translate dates — pointerup writes
  // `priority = gutterBand` instead of persisting the snapped dates.
  gutterBand: CardPriority | null;
  origPriority: CardPriority | null;
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

  // ---- Drag state (refs to avoid re-renders during pointermove) ----
  const dragRef = useRef<DragState | null>(null);
  const [, startTransition] = useTransition();

  // Plan #16b-γ-G G3 — drag-paint state. The user pointerdowns on empty
  // canvas and drags horizontally; on pointerup we open the new-card
  // dialog with start/target prefilled. The ref carries cursor/anchor
  // info, the rect state drives the visual ghost.
  const paintRef = useRef<{
    startClientX: number;
    startCanvasX: number;
    currentCanvasX: number;
    row: { top: number; height: number; laneId: string; epicId: string | null; boardId: string | null };
  } | null>(null);
  const [paintRect, setPaintRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // Plan #16b-γ-G G7 — header NEW CARD chip is also a drag source. On
  // pointerdown we record the origin; pointermove follows the cursor as
  // a translucent floating chip and hit-tests against the canvas to
  // resolve a target row + day. On pointerup we either treat the
  // gesture as a click (delta < 4px → empty dialog, D2 parity) or a
  // drag (over canvas → dialog with start/target/parent/board prefill;
  // released outside → cancel).
  const chipDragRef = useRef<{
    startClientX: number;
    startClientY: number;
    over: {
      row: {
        top: number;
        height: number;
        laneId: string;
        epicId: string | null;
        boardId: string | null;
      };
      canvasX: number;
    } | null;
  } | null>(null);
  const [chipGhost, setChipGhost] = useState<{
    clientX: number;
    clientY: number;
  } | null>(null);
  // Mirrors `dragHoverLaneId` semantics for the chip drag — highlights the
  // lane the cursor is over so the user gets the same visual affordance as
  // bar-drag reparent. Reuses the `roadmap-lane-target` overlay below.
  const [chipHoverLaneId, setChipHoverLaneId] = useState<string | null>(null);

  // Plan #16b-γ-G G2 — visual highlight on the lane the cursor is over
  // while dragging a bar across lanes. Only set when hoverLaneId differs
  // from sourceLaneId so the source lane never highlights itself. State
  // (not ref) so the lane overlay re-renders on crossing.
  const [dragHoverLaneId, setDragHoverLaneId] = useState<string | null>(null);
  const dragSourceLaneIdRef = useRef<string | null>(null);

  // Plan #16b-γ-G G4 — gutter band the cursor is currently hovering
  // during a bar drag. State (not ref) so the gutter band re-renders
  // with the highlighted ring as the cursor moves vertically. Mirrored
  // into dragRef.gutterBand so pointerup reads the latest value.
  const [hoveredGutterBand, setHoveredGutterBand] =
    useState<CardPriority | null>(null);

  // Plan #16b-γ-G G6 polish — Alt-key bypass + visual snap guide.
  // `lastAltKeyRef` is updated on every pointermove so onPointerUp
  // (which doesn't take an event) can read the latest Alt state. When
  // true at release, the snap step is skipped and the rounded-to-day
  // position is persisted as-is.
  const lastAltKeyRef = useRef(false);
  // Per-drag snap candidate caches, populated once at beginDrag so the
  // pointermove preview computation is cheap (no per-move sprint/blocker
  // rebuilds; see G6 perf note in the plan).
  const dragBlockerTargetsRef = useRef<
    Array<{ date: Date; cardTitle: string }>
  >([]);
  const dragSprintEndsRef = useRef<Array<{ date: Date; name: string }>>([]);
  // Snap preview shown during drag (cleared on pointerup or when out of
  // window). State (not ref) so the guide/label re-render as the cursor
  // moves through the 4-day snap window. Mirrored into a ref so the
  // pointermove handler can read the latest value without putting it
  // in its deps (which would re-bind the listener mid-drag).
  const [snapPreview, setSnapPreview] = useState<{
    date: Date;
    label: string;
    kind: "monday" | "sprint" | "blocker";
  } | null>(null);
  const snapPreviewRef = useRef(snapPreview);
  snapPreviewRef.current = snapPreview;
  // Ref to the gutter element for clientX hit-testing during drags.
  const gutterRef = useRef<HTMLDivElement | null>(null);
  // We read `gutterOn` inside callbacks bound at mount; mirror it via
  // a ref so the latest value is read without re-binding listeners.
  const gutterOnRef = useRef(gutterOn);
  gutterOnRef.current = gutterOn;

  // Ref to the lane label panel for row-drag hit-testing (G1). Declared
  // up here so the row-drag callbacks can reference it cleanly.
  const labelPanelRef = useRef<HTMLDivElement | null>(null);

  // Refs for cascade detection — read latest store data inside async drag
  // commit without re-binding the callback.
  const storeCardsRef = useRef(storeCards);
  storeCardsRef.current = storeCards;
  const storeLinksRef = useRef(storeLinks);
  storeLinksRef.current = storeLinks;

  const collectDependents = useCallback(
    (rootId: string): CascadeAffectedCard[] => {
      const cardById = new Map(storeCardsRef.current.map((c) => [c.id, c]));
      const visited = new Set<string>([rootId]);
      const out: CascadeAffectedCard[] = [];
      let frontier: string[] = [rootId];
      for (let depth = 0; depth < 50; depth++) {
        if (frontier.length === 0) break;
        const next: string[] = [];
        for (const l of storeLinksRef.current) {
          if (l.kind !== "is_blocked_by") continue;
          if (!frontier.includes(l.toCardId)) continue;
          // l: from is blocked by to. We're walking from blocker (to) to
          // dependent (from).
          const depId = l.fromCardId;
          if (visited.has(depId)) continue;
          visited.add(depId);
          const c = cardById.get(depId);
          out.push({ id: depId, title: c?.title ?? depId });
          next.push(depId);
        }
        frontier = next;
      }
      return out;
    },
    [],
  );

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
        // Plan #16b-γ-A (#4) — if auto-cascade is on and the target_date
        // moved forward, surface a confirmation dialog listing every
        // transitively blocked dependent the same delta would shift.
        const targetDeltaMs =
          next.target.getTime() - orig.target.getTime();
        const deltaDays = Math.round(targetDeltaMs / 86_400_000);
        if (autoCascadeRef.current && deltaDays > 0) {
          const affected = collectDependents(cardId);
          if (affected.length > 0) {
            setCascadeState({
              open: true,
              rootCardId: cardId,
              deltaDays,
              affected,
            });
          }
        }
        // Don't manually re-set the store: the realtime CDC echo will
        // reconcile via `useWorkspaceRealtime`. Server-side
        // `revalidatePath` also refreshes the SSR snapshot on next nav.
      } catch (err) {
        // Revert the optimistic patch on failure.
        patchCardInStore(cardId, { startDate: orig.start, targetDate: orig.target });
        toast.error((err as Error).message);
      }
    },
    [patchCardInStore, collectDependents],
  );

  // Plan #16b-γ-C (C3) — auto-scroll the scroller when the cursor enters a
  // hot zone near its left/right edge during a drag. RAF loop is lazily
  // started on the first pointermove of a drag and stopped on pointerup /
  // unmount. We adjust dragRef.startClientX by the actual scroll delta so
  // the next pointermove sees a consistent deltaPx; bar position only
  // refreshes on real cursor movement (acceptable tradeoff for the simpler
  // implementation — a stationary cursor at the edge will see the canvas
  // slide while the bar visually lags by ≤1 frame until the next move).
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
    const HOT = 60; // px from each edge
    const MAX_PX = 12; // per tick (~720 px/sec at 60 fps)
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
      // scrollLeft is clamped by the browser to [0, scrollWidth-clientWidth];
      // shift startClientX by the ACTUAL delta so deltaPx stays consistent.
      const actualDx = scroller.scrollLeft - before;
      drag.startClientX -= actualDx;
    }
    autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
  }, []);

  // Plan #16b-γ-G G6 polish — companion to `snapDate` that also returns
  // which kind of candidate matched and a human label to display next
  // to the snap-guide line. Used only by the in-drag preview; the
  // pointerup path keeps using `snapDate` for backwards compat. Sprint
  // ends and blocker target_dates are read from per-drag refs filled in
  // by `beginDrag` so we don't rebuild them on every pointer event.
  const snapDateWithSource = useCallback(
    (
      d: Date,
      includeBlockers: boolean,
    ): {
      date: Date;
      label: string;
      kind: "monday" | "sprint" | "blocker";
    } | null => {
      type Cand = {
        date: Date;
        kind: "monday" | "sprint" | "blocker";
        label: string;
      };
      const candidates: Cand[] = [];
      // Mondays.
      const day = d.getUTCDay();
      const sinceMonday = (day + 6) % 7;
      const prevMonday = addDays(startOfDay(d), -sinceMonday);
      const nextMonday = addDays(prevMonday, 7);
      candidates.push(
        { date: prevMonday, kind: "monday", label: "Mon" },
        { date: nextMonday, kind: "monday", label: "Mon" },
      );
      // Sprint ends — read from per-drag cache.
      for (const s of dragSprintEndsRef.current) {
        candidates.push({
          date: s.date,
          kind: "sprint",
          label: `${s.name} end`,
        });
      }
      // Blocker target_dates — only on the start edge (move + resize-left).
      if (includeBlockers) {
        for (const b of dragBlockerTargetsRef.current) {
          candidates.push({
            date: b.date,
            kind: "blocker",
            label: b.cardTitle,
          });
        }
      }
      let best: Cand | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const c of candidates) {
        const diff = Math.abs(dayDiff(d, c.date));
        if (diff <= 4 && diff < bestDiff) {
          best = c;
          bestDiff = diff;
        }
      }
      return best;
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      lastClientXRef.current = e.clientX;
      // Plan #16b-γ-G G6 polish — track Alt-key state for pointerup to
      // read. Holding Alt at release skips the snap step entirely.
      lastAltKeyRef.current = e.altKey;

      // Plan #16b-γ-G G4 — gutter detection. Only meaningful in `move`
      // mode and when the gutter is on. We hit-test the cursor against
      // the gutter element's bounding rect; entering it suspends date
      // translation and selects a band by Y. Leaving it (cursor.x past
      // gutter.right) exits gutter mode and resumes normal drag.
      if (d.mode === "move" && gutterOnRef.current) {
        const gutter = gutterRef.current;
        if (gutter) {
          const gRect = gutter.getBoundingClientRect();
          const inGutter =
            e.clientX >= gRect.left &&
            e.clientX < gRect.right &&
            e.clientY >= gRect.top &&
            e.clientY < gRect.bottom;
          if (inGutter) {
            // Five equal vertical bands — index by Y offset.
            const localY = e.clientY - gRect.top;
            const bandHeight = gRect.height / PRIORITIES.length;
            const idx = Math.min(
              PRIORITIES.length - 1,
              Math.max(0, Math.floor(localY / bandHeight)),
            );
            const band = PRIORITIES[idx];
            if (d.gutterBand !== band) {
              d.gutterBand = band;
              setHoveredGutterBand(band);
            }
            // Clear any lane-crossing highlight from prior non-gutter
            // frames so the cross-lane indicator doesn't linger.
            if (d.currentLaneId !== d.sourceLaneId) {
              d.currentLaneId = d.sourceLaneId;
              setDragHoverLaneId(null);
            }
            // While in gutter mode: keep the bar visually pinned at its
            // original dates, NOT the cursor-projected ones.
            patchCardInStore(d.cardId, {
              startDate: d.origStart,
              targetDate: d.origTarget,
            });
            // Auto-scroll loop is still useful for horizontal escape
            // out of the gutter, but not strictly required while parked.
            if (autoScrollRafRef.current === null) {
              autoScrollRafRef.current =
                requestAnimationFrame(tickAutoScroll);
            }
            return;
          }
          // Not in gutter — clear band if previously set.
          if (d.gutterBand !== null) {
            d.gutterBand = null;
            setHoveredGutterBand(null);
          }
        }
      }

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
      // Plan #16b-γ-G G2 — vertical hit-test for cross-lane reparent.
      // Only meaningful in epic mode + during a `move` drag (resizing
      // never reparents). `sourceLaneId` is null in non-epic modes so we
      // gate on it to skip the hit-test entirely there.
      if (d.mode === "move" && d.sourceLaneId !== null) {
        const canvas = canvasRef.current;
        if (canvas) {
          const localY = e.clientY - canvas.getBoundingClientRect().top;
          const lanes = laneLayoutRef.current;
          let nextLaneId: string | null = null;
          for (const ll of lanes) {
            if (localY >= ll.top && localY < ll.top + ll.height) {
              nextLaneId = ll.lane.id;
              break;
            }
          }
          if (nextLaneId !== d.currentLaneId) {
            d.currentLaneId = nextLaneId;
            // Highlight the lane only when it's a different lane from
            // the source. The source lane never highlights itself
            // (cursor returning to the source clears the indicator).
            const highlight =
              nextLaneId !== null && nextLaneId !== d.sourceLaneId
                ? nextLaneId
                : null;
            setDragHoverLaneId(highlight);
          }
        }
      }
      // Plan #16b-γ-G G6 polish — visual snap guide. Compute the snap
      // candidate the START / TARGET edge would land on if released
      // here. Mirrors the per-edge snap rules in `onPointerUp`:
      // resize-left / move's start side may snap to blockers, sprint
      // ends, or Mondays; resize-right / move's target side may NOT
      // snap to blockers. In move mode we pick whichever edge has the
      // closer candidate (preserving duration is irrelevant for the
      // *preview* — we just show what would happen). Alt held suppresses
      // the preview because the release will skip snap.
      const currentPreview = snapPreviewRef.current;
      if (d.gutterBand !== null || e.altKey) {
        if (currentPreview !== null) setSnapPreview(null);
      } else {
        let preview: typeof currentPreview = null;
        if (d.mode === "resize-left") {
          preview = snapDateWithSource(startOfDay(nextStart), true);
        } else if (d.mode === "resize-right") {
          preview = snapDateWithSource(startOfDay(nextTarget), false);
        } else {
          // move mode — try both edges, pick the closer one.
          const startCand = snapDateWithSource(startOfDay(nextStart), true);
          const targetCand = snapDateWithSource(startOfDay(nextTarget), false);
          const startDelta = startCand
            ? Math.abs(dayDiff(startOfDay(nextStart), startCand.date))
            : Number.POSITIVE_INFINITY;
          const targetDelta = targetCand
            ? Math.abs(dayDiff(startOfDay(nextTarget), targetCand.date))
            : Number.POSITIVE_INFINITY;
          preview =
            startDelta <= targetDelta ? startCand : targetCand;
        }
        // Avoid setState churn on identity-stable previews. Compare by
        // (date, kind, label) rather than by reference.
        const same =
          (preview === null && currentPreview === null) ||
          (preview !== null &&
            currentPreview !== null &&
            preview.date.getTime() === currentPreview.date.getTime() &&
            preview.kind === currentPreview.kind &&
            preview.label === currentPreview.label);
        if (!same) setSnapPreview(preview);
      }
      // Lazily start the auto-scroll RAF on the first move of a drag.
      if (autoScrollRafRef.current === null) {
        autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
      }
    },
    [ppd, patchCardInStore, tickAutoScroll, snapDateWithSource],
  );

  // Plan #16b-α (#10) — snap-to-week-Monday + snap-to-sprint-end on
  // pointer release. Window: within 4 days of a candidate snap target,
  // we snap to the nearest one; otherwise the rounded-to-day position
  // (preserved by the drag delta math) is kept as-is. Sprint end_dates
  // come from the workspace store; weeks are computed deterministically
  // off the dragged date itself.
  // Plan #16b-γ-C (C4) — `extraCandidates` lets the caller add more
  // snap targets for this invocation only. Used to snap a dragged
  // card's start_date onto its blocker's target_date, so dropping
  // near a dependency end snaps cleanly to it.
  const snapDate = useCallback(
    (d: Date, extraCandidates: Date[] = []): Date => {
      const candidates: Date[] = [...extraCandidates];
      // Nearest Monday (UTC).
      const day = d.getUTCDay();
      const sinceMonday = (day + 6) % 7; // Mon=0
      const prevMonday = addDays(startOfDay(d), -sinceMonday);
      const nextMonday = addDays(prevMonday, 7);
      candidates.push(prevMonday, nextMonday);
      // Sprint end_dates.
      for (const s of storeSprints) {
        if (s.endDate)
          candidates.push(
            startOfDay(s.endDate instanceof Date ? s.endDate : new Date(s.endDate)),
          );
      }
      let best: Date | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const c of candidates) {
        const diff = Math.abs(dayDiff(d, c));
        if (diff <= 4 && diff < bestDiff) {
          best = c;
          bestDiff = diff;
        }
      }
      return best ?? startOfDay(d);
    },
    [storeSprints],
  );

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    // Plan #16b-γ-G G6 polish — capture Alt state then reset all the
    // per-drag refs/state. Alt was last written by `onPointerMove`.
    const altBypass = lastAltKeyRef.current;
    lastAltKeyRef.current = false;
    dragRef.current = null;
    dragSourceLaneIdRef.current = null;
    setDragHoverLaneId(null);
    setHoveredGutterBand(null);
    setSnapPreview(null);
    dragBlockerTargetsRef.current = [];
    dragSprintEndsRef.current = [];
    stopAutoScroll();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const current = cardsRef.current.find((c) => c.id === d.cardId);
    if (!current) return;

    // Plan #16b-γ-G G4 — pointerup INSIDE the gutter writes priority
    // (and skips date snap / lane reparent entirely). The user's intent
    // is unambiguous: they parked the bar in a band. We optimistically
    // patch the store, then persist via updateCard. The bar visually
    // stays at its original dates because the move-mode pointermove
    // pinned them while in gutter mode.
    if (d.mode === "move" && d.gutterBand !== null) {
      const cardId = d.cardId;
      const nextPriority = d.gutterBand;
      const origPriority = d.origPriority;
      if (nextPriority === origPriority) return;
      patchCardInStore(cardId, { priority: nextPriority });
      startTransition(() => {
        void (async () => {
          try {
            await updateCard({ id: cardId, priority: nextPriority });
          } catch (err) {
            patchCardInStore(cardId, { priority: origPriority });
            toast.error((err as Error).message);
          }
        })();
      });
      return;
    }
    // Plan #16b-γ-G G2 — detect cross-lane reparent. Only valid in epic
    // mode (sourceLaneId is null elsewhere) AND in move mode (resize
    // never reparents). Triggers regardless of horizontal movement —
    // a purely vertical drag is a legitimate reparent gesture that
    // wouldn't be a click.
    const reparented =
      d.mode === "move" &&
      d.sourceLaneId !== null &&
      d.currentLaneId !== null &&
      d.currentLaneId !== d.sourceLaneId;
    const noOp =
      current.startDate.getTime() === d.origStart.getTime() &&
      current.targetDate.getTime() === d.origTarget.getTime();
    if (noOp && !reparented) {
      // A1 — a move-mode pointerdown/up with no movement is a click;
      // open the card modal. Resize handles enter resize-* mode and
      // are intentionally excluded.
      if (d.mode === "move") {
        router.push(`/b/${current.boardId}/c/${d.cardId}`);
      }
      return;
    }
    if (reparented) {
      // Resolve target epic id: the destination lane's headerCard.id, or
      // null if the destination is the "uncategorized" lane (no parent).
      const targetLane = laneLayoutRef.current.find(
        (ll) => ll.lane.id === d.currentLaneId,
      );
      const targetEpicId = targetLane?.lane.headerCard?.id ?? null;
      const targetTitle =
        targetLane?.lane.title ??
        (targetEpicId ? "destination" : "Uncategorized");
      // Capture the original parent for revert on failure. Read from the
      // store (not the projected `cards`) so we get the full nullable.
      const origCard = storeCardsRef.current.find((c) => c.id === d.cardId);
      const origParentId = origCard?.parentCardId ?? null;
      // Optimistic patch — the store update flips the lane the bar
      // belongs to so the next render places it on the destination row.
      patchCardInStore(d.cardId, { parentCardId: targetEpicId });
      const cardId = d.cardId;
      startTransition(() => {
        void (async () => {
          try {
            await updateCard({ id: cardId, parentCardId: targetEpicId });
          } catch (err) {
            // Revert + surface to the persistent error pane (plan #16b-γ-C
            // #6 says action failures belong on the error bus, not toasts).
            patchCardInStore(cardId, { parentCardId: origParentId });
            const raw = (err as Error).message ?? "Reparent failed";
            // Action wraps the cycle-guard error with a stable PARENT_CYCLE
            // prefix so we don't have to match the trigger's English text.
            const isCycle = raw.startsWith("PARENT_CYCLE");
            const message = isCycle
              ? `Cannot move card under ${targetTitle} — cycle detected.`
              : `Reparent failed: ${raw}`;
            errorBus.push({ message });
          }
        })();
      });
      // Fall through: dates may also have changed in the same drag, so
      // we still need to run the snap + persist branch below. If
      // `noOp` is true the date-persist branch skips itself naturally.
    }
    if (noOp) return;

    // Plan #16b-γ-C (C4) — additional snap candidates for the START
    // edge: target_dates of any card that blocks the dragged card
    // (`is_blocked_by` links from the dragged card). Computed here
    // while dragRef is still meaningful and storeLinksRef/storeCardsRef
    // hold the latest data. Filtered to blockers with a non-null
    // target_date; null targets are skipped.
    const blockerCardIds = storeLinksRef.current
      .filter((l) => l.fromCardId === d.cardId && l.kind === "is_blocked_by")
      .map((l) => l.toCardId);
    const blockerTargets: Date[] = (() => {
      if (blockerCardIds.length === 0) return [];
      const cardById = new Map(
        storeCardsRef.current.map((c) => [c.id, c]),
      );
      const out: Date[] = [];
      for (const id of blockerCardIds) {
        const c = cardById.get(id);
        if (c && c.targetDate) {
          out.push(
            startOfDay(
              c.targetDate instanceof Date
                ? c.targetDate
                : new Date(c.targetDate),
            ),
          );
        }
      }
      return out;
    })();

    // Apply snap depending on drag mode. In move-mode we snap the
    // edge that's closest to a target, preserving the duration; in
    // resize modes we snap only the dragged edge. Blocker target_dates
    // are passed only to the START-edge snap calls (resize-left and
    // move's start side); the END edge does not snap to dependency ends.
    // Plan #16b-γ-G G6 polish — `altBypass` skips the snap step
    // entirely so the user can park a bar at an arbitrary day. The
    // rounded-to-day position from `onPointerMove` is preserved as-is.
    let snappedStart = startOfDay(current.startDate);
    let snappedTarget = startOfDay(current.targetDate);
    if (!altBypass) {
      if (d.mode === "resize-left") {
        snappedStart = snapDate(snappedStart, blockerTargets);
      } else if (d.mode === "resize-right") {
        snappedTarget = snapDate(snappedTarget);
      } else {
        const startSnap = snapDate(snappedStart, blockerTargets);
        const targetSnap = snapDate(snappedTarget);
        const startDelta = Math.abs(dayDiff(snappedStart, startSnap));
        const targetDelta = Math.abs(dayDiff(snappedTarget, targetSnap));
        // Prefer the edge that snapped (smaller delta), then translate
        // both ends to preserve duration.
        if (startDelta <= targetDelta && startDelta <= 4) {
          const shift = dayDiff(snappedStart, startSnap);
          snappedStart = startSnap;
          snappedTarget = addDays(snappedTarget, shift);
        } else if (targetDelta <= 4) {
          const shift = dayDiff(snappedTarget, targetSnap);
          snappedTarget = targetSnap;
          snappedStart = addDays(snappedStart, shift);
        }
      }
    }
    if (snappedStart.getTime() > snappedTarget.getTime()) {
      snappedStart = snappedTarget;
    }

    // Reflect snap in the store immediately so the bar visually settles.
    if (
      snappedStart.getTime() !== current.startDate.getTime() ||
      snappedTarget.getTime() !== current.targetDate.getTime()
    ) {
      patchCardInStore(d.cardId, {
        startDate: snappedStart,
        targetDate: snappedTarget,
      });
    }

    startTransition(() => {
      void persistDates(
        d.cardId,
        { start: d.origStart, target: d.origTarget },
        { start: snappedStart, target: snappedTarget },
      );
    });
  }, [onPointerMove, persistDates, snapDate, patchCardInStore, router, stopAutoScroll]);

  const beginDrag = useCallback(
    (mode: DragMode, e: React.PointerEvent, cardId: string) => {
      const c = cardsRef.current.find((x) => x.id === cardId);
      if (!c) return;
      e.preventDefault();
      // Plan #16b-γ-G G2 — record which lane currently owns this card so
      // pointermove can detect crossings. We resolve it by walking the
      // current laneLayout: a card is the source-lane's headerCard, or
      // appears in its placed-rows. Only computed in epic mode; in other
      // modes vertical movement does NOT reparent so we skip entirely.
      let sourceLaneId: string | null = null;
      if (laneMode === "epic" && mode === "move") {
        for (const ll of laneLayoutRef.current) {
          if (ll.lane.headerCard?.id === cardId) {
            sourceLaneId = ll.lane.id;
            break;
          }
          if (ll.placed.some((p) => p.card.id === cardId)) {
            sourceLaneId = ll.lane.id;
            break;
          }
        }
      }
      dragSourceLaneIdRef.current = sourceLaneId;
      dragRef.current = {
        cardId,
        mode,
        startClientX: e.clientX,
        origStart: c.startDate,
        origTarget: c.targetDate,
        sourceLaneId,
        currentLaneId: sourceLaneId,
        gutterBand: null,
        origPriority: c.priority ?? null,
      };
      // Plan #16b-γ-G G6 polish — pre-compute per-drag snap candidates
      // (sprint ends with names; blocker target_dates with card titles)
      // so `onPointerMove` doesn't rebuild them at pointer-event rate.
      const sprintEnds: Array<{ date: Date; name: string }> = [];
      for (const s of storeSprints) {
        if (s.endDate) {
          sprintEnds.push({
            date: startOfDay(
              s.endDate instanceof Date ? s.endDate : new Date(s.endDate),
            ),
            name: s.name,
          });
        }
      }
      dragSprintEndsRef.current = sprintEnds;
      const blockerCardIds = storeLinksRef.current
        .filter(
          (l) => l.fromCardId === cardId && l.kind === "is_blocked_by",
        )
        .map((l) => l.toCardId);
      const blockerTargets: Array<{ date: Date; cardTitle: string }> = [];
      if (blockerCardIds.length > 0) {
        const cardById = new Map(
          storeCardsRef.current.map((sc) => [sc.id, sc]),
        );
        for (const id of blockerCardIds) {
          const bc = cardById.get(id);
          if (bc && bc.targetDate) {
            blockerTargets.push({
              date: startOfDay(
                bc.targetDate instanceof Date
                  ? bc.targetDate
                  : new Date(bc.targetDate),
              ),
              cardTitle: bc.title,
            });
          }
        }
      }
      dragBlockerTargetsRef.current = blockerTargets;
      lastAltKeyRef.current = e.altKey;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [laneMode, onPointerMove, onPointerUp, storeSprints],
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

  // Plan #16b-γ-G G1 — row-drag state for manual roadmap row reorder.
  // Lives in a ref + a useState pair: the ref holds the active drag
  // metadata (no re-render on each pointermove for responsiveness) and
  // the state mirrors the current Y so the ghost overlay re-renders.
  // Only active in epic mode — assignee / component lanes have no
  // stable "card identity" we'd persist a rank against.
  type RowDragState = {
    cardId: string;
    boardId: string;
    laneIndex: number;
    startClientY: number;
  };
  const rowDragRef = useRef<RowDragState | null>(null);
  const [rowDragGhost, setRowDragGhost] = useState<{
    cardId: string;
    laneIndex: number;
    currentY: number;
    insertIndex: number;
  } | null>(null);

  // Snapshot lane geometry for hit-testing during the drag. Captured at
  // pointerdown so a re-flow of the canvas mid-drag (unlikely, but
  // possible if a CDC echo lands) doesn't tear the math.
  const rowDragLanesRef = useRef<
    Array<{
      laneIndex: number;
      cardId: string | null;
      boardId: string | null;
      top: number;
      height: number;
    }>
  >([]);

  const onRowPointerMove = useCallback((e: PointerEvent) => {
    const drag = rowDragRef.current;
    if (!drag) return;
    const lanes = rowDragLanesRef.current;
    if (lanes.length === 0) return;
    const y = e.clientY;
    // Resolve the insertion index relative to the LANE LABEL panel by
    // converting the cursor's clientY into the panel's local Y. The
    // panel's top is captured implicitly via the lanes' canvas-local
    // tops + the panel's bounding rect.
    const panel = labelPanelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const localY = y - rect.top;
    let insertIndex = lanes.length;
    for (let i = 0; i < lanes.length; i++) {
      const ln = lanes[i];
      if (localY < ln.top + ln.height / 2) {
        insertIndex = i;
        break;
      }
    }
    setRowDragGhost({
      cardId: drag.cardId,
      laneIndex: drag.laneIndex,
      currentY: localY,
      insertIndex,
    });
  }, []);

  const onRowPointerUp = useCallback(() => {
    const drag = rowDragRef.current;
    if (!drag) return;
    rowDragRef.current = null;
    const ghost = rowDragGhostRef.current;
    setRowDragGhost(null);
    window.removeEventListener("pointermove", onRowPointerMove);
    window.removeEventListener("pointerup", onRowPointerUp);
    if (!ghost) return;
    const lanes = rowDragLanesRef.current;
    if (lanes.length === 0) return;

    // Build the eligible-neighbour list, excluding the dragged lane and
    // any non-epic lane (no headerCard → no card to rank).
    const neighbours = lanes.filter(
      (ln) => ln.laneIndex !== drag.laneIndex && ln.cardId !== null,
    );
    const insertIdx = ghost.insertIndex;
    // Translate insert index in the FULL `lanes` array into the
    // neighbours-array slot the dragged lane will land between.
    let neighbourSlot = 0;
    for (let i = 0; i < insertIdx; i++) {
      const ln = lanes[i];
      if (ln.laneIndex === drag.laneIndex) continue;
      neighbourSlot++;
    }
    const beforeId = neighbourSlot > 0 ? neighbours[neighbourSlot - 1].cardId : null;
    const afterId =
      neighbourSlot < neighbours.length ? neighbours[neighbourSlot].cardId : null;

    // No-op: dropped exactly where it was.
    if (beforeId === null && afterId === null) return;
    const origNeighbours = lanes
      .filter((ln) => ln.cardId !== null && ln.laneIndex !== drag.laneIndex);
    const origIdx = lanes.findIndex((ln) => ln.cardId === drag.cardId);
    const origNeighbourBefore =
      origIdx > 0
        ? lanes
            .slice(0, origIdx)
            .reverse()
            .find((ln) => ln.cardId !== null && ln.laneIndex !== drag.laneIndex)
            ?.cardId ?? null
        : null;
    void origNeighbours;
    if (
      beforeId === origNeighbourBefore &&
      afterId !== null &&
      origIdx < lanes.findIndex((ln) => ln.cardId === afterId)
    ) {
      // Same slot — skip server round-trip.
      return;
    }

    const cardId = drag.cardId;
    const boardId = drag.boardId;
    // Capture original roadmapOrder for revert.
    const origCard = storeCardsRef.current.find((c) => c.id === cardId);
    const origRoadmapOrder = origCard?.roadmapOrder ?? null;

    // Optimistic patch: pick a synthetic mid-rank using the neighbours'
    // current orders. If we can't compute one cleanly we let the server
    // assign and wait for the realtime echo. Using fallbacks here keeps
    // the UI from snapping back briefly during the round-trip.
    const beforeOrd =
      beforeId
        ? storeCardsRef.current.find((c) => c.id === beforeId)?.roadmapOrder ??
          null
        : null;
    const afterOrd =
      afterId
        ? storeCardsRef.current.find((c) => c.id === afterId)?.roadmapOrder ??
          null
        : null;
    let optimistic: number | null = null;
    if (beforeOrd !== null && afterOrd !== null) {
      const m = Math.floor((beforeOrd + afterOrd) / 2);
      if (m !== beforeOrd && m !== afterOrd) optimistic = m;
    } else if (beforeOrd !== null) optimistic = beforeOrd + 1024;
    else if (afterOrd !== null) optimistic = afterOrd - 1024;
    else optimistic = 1024;
    if (optimistic !== null) {
      patchCardInStore(cardId, { roadmapOrder: optimistic });
    }

    startTransition(() => {
      void (async () => {
        try {
          const r = await reorderRoadmapRow({
            cardId,
            beforeId,
            afterId,
            boardId,
          });
          patchCardInStore(cardId, { roadmapOrder: r.roadmapOrder });
        } catch (err) {
          patchCardInStore(cardId, { roadmapOrder: origRoadmapOrder });
          toast.error((err as Error).message);
        }
      })();
    });
  }, [onRowPointerMove, patchCardInStore]);

  // Keep the ghost in a ref so onRowPointerUp can read the latest value
  // without re-binding (which would re-attach window listeners).
  const rowDragGhostRef = useRef(rowDragGhost);
  rowDragGhostRef.current = rowDragGhost;

  const beginRowDrag = useCallback(
    (cardId: string, e: React.PointerEvent) => {
      // Only valid in epic mode + when the lane has a headerCard. The
      // handle is gated to epic mode at render-time so we just confirm.
      if (laneMode !== "epic") return;
      // Capture lane geometry from the current laneLayout for hit
      // testing. We compute the panel-local tops by subtracting the
      // panel header strip (the "LANE" label row uses HEADER_STRIP_HEIGHT
      // which is *also* the canvas's HEADER_STRIP_HEIGHT — they share
      // the strip).
      const panel = labelPanelRef.current;
      if (!panel) return;
      let cursor = HEADER_STRIP_HEIGHT;
      const lanesGeo = laneLayout.map((ll, idx) => {
        const top = cursor;
        cursor += ll.height;
        return {
          laneIndex: idx,
          cardId: ll.lane.headerCard?.id ?? null,
          boardId: ll.lane.headerCard?.boardId ?? null,
          top,
          height: ll.height,
        };
      });
      rowDragLanesRef.current = lanesGeo;
      const me = lanesGeo.find((ln) => ln.cardId === cardId);
      if (!me) return;
      const card = storeCardsRef.current.find((c) => c.id === cardId);
      if (!card) return;
      rowDragRef.current = {
        cardId,
        boardId: card.boardId,
        laneIndex: me.laneIndex,
        startClientY: e.clientY,
      };
      setRowDragGhost({
        cardId,
        laneIndex: me.laneIndex,
        currentY: e.clientY - panel.getBoundingClientRect().top,
        insertIndex: me.laneIndex,
      });
      window.addEventListener("pointermove", onRowPointerMove);
      window.addEventListener("pointerup", onRowPointerUp);
    },
    [laneLayout, laneMode, onRowPointerMove, onRowPointerUp],
  );

  // Plan #16b-γ-G G3 — drag-paint on empty canvas → new card. Supersedes
  // D2's click-to-create: a click without drag (delta < 4px) still opens
  // the dialog with `defaultStart` only (D2 parity); a drag paints a
  // visual ghost rect for the date range and opens the dialog with both
  // `defaultStart` and `defaultTarget` set. Backward paint swaps so
  // start ≤ target. The lane the paint started on resolves the epic
  // parent + board so the new card lands in the right slot.
  //
  // The `target === currentTarget` guard keeps pointerdowns on bars /
  // overlays / lane labels / today line from bubbling up here; only
  // true empty space on the canvas div fires.
  const PAINT_THRESHOLD_PX = 4;
  const onPaintPointerMove = useCallback(
    (e: PointerEvent) => {
      const p = paintRef.current;
      if (!p) return;
      const deltaPx = e.clientX - p.startClientX;
      const newCanvasX = p.startCanvasX + deltaPx;
      p.currentCanvasX = newCanvasX;
      // Snap each end to whole-day grid for a cleaner ghost. We snap by
      // rounding the canvas-x to the nearest day boundary.
      const aSnap = Math.round(p.startCanvasX / ppd) * ppd;
      const bSnap = Math.round(newCanvasX / ppd) * ppd;
      const left = Math.min(aSnap, bSnap);
      const right = Math.max(aSnap, bSnap);
      // Width is at least one day so the ghost is always visible while
      // painting (matches the "click = single-day" mental model).
      const width = Math.max(ppd, right - left + ppd);
      setPaintRect({
        left,
        top: p.row.top,
        width,
        height: p.row.height,
      });
    },
    [ppd],
  );

  // `finishPaint` references `onPaintPointerUp`, which references
  // `finishPaint` — break the cycle with a ref so the cleanup inside
  // `finishPaint` can detach the same listener instance that was
  // attached on pointerdown.
  const onPaintPointerUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  const finishPaint = useCallback(
    (cancelled: boolean) => {
      window.removeEventListener("pointermove", onPaintPointerMove);
      const upHandler = onPaintPointerUpRef.current;
      if (upHandler) window.removeEventListener("pointerup", upHandler);
      const p = paintRef.current;
      paintRef.current = null;
      setPaintRect(null);
      if (!p || cancelled) return;
      const deltaPx = Math.abs(p.currentCanvasX - p.startCanvasX);
      const aDays = Math.max(0, Math.round(p.startCanvasX / ppd));
      const bDays = Math.max(0, Math.round(p.currentCanvasX / ppd));
      const startDays = Math.min(aDays, bDays);
      const endDays = Math.max(aDays, bDays);
      const startISO = addDays(gridStart, startDays).toISOString().slice(0, 10);
      const endISO = addDays(gridStart, endDays).toISOString().slice(0, 10);
      // Resolve the epic's boardId so the dialog defaults to the right
      // board. Uncategorized lane → no parent → fall back to first
      // visible board (handled by the dialog).
      const epicBoardId = p.row.boardId;
      if (deltaPx < PAINT_THRESHOLD_PX) {
        // Click-style: D2 parity (start only, no target).
        setNewCardDefaults({
          start: startISO,
          board: epicBoardId ?? undefined,
          parent: p.row.epicId,
        });
      } else {
        setNewCardDefaults({
          start: startISO,
          target: endISO,
          board: epicBoardId ?? undefined,
          parent: p.row.epicId,
        });
      }
      setNewCardOpen(true);
    },
    [gridStart, onPaintPointerMove, ppd],
  );

  const onPaintPointerUp = useCallback(() => {
    finishPaint(false);
  }, [finishPaint]);
  onPaintPointerUpRef.current = onPaintPointerUp;

  const onCanvasEmptyPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      // Only react to primary button (left click / single touch).
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Walk laneLayout to find which row the cursor is on. Skip the
      // lane's header row (top LANE_HEADER_HEIGHT band) so we always
      // paint inside the body. We resolve the epic via lane.headerCard
      // — null for "uncategorized".
      const ll = laneLayout.find(
        (entry) => y >= entry.top && y < entry.top + entry.height,
      );
      if (!ll) return;
      const bodyTop = ll.top + LANE_HEADER_HEIGHT;
      // If the cursor is in the lane header strip itself, snap the paint
      // row to the first body row so painting "above" the bars still
      // works the way users expect.
      const yInBody = Math.max(0, y - bodyTop);
      const rowIdx = Math.floor(yInBody / ROW_HEIGHT);
      const rowTop = bodyTop + rowIdx * ROW_HEIGHT;
      const epic = ll.lane.headerCard;
      const epicBoardId = epic
        ? storeCardsRef.current.find((c) => c.id === epic.id)?.boardId ?? null
        : null;
      paintRef.current = {
        startClientX: e.clientX,
        startCanvasX: x,
        currentCanvasX: x,
        row: {
          top: rowTop,
          height: ROW_HEIGHT,
          laneId: ll.lane.id,
          epicId: epic?.id ?? null,
          boardId: epicBoardId,
        },
      };
      // Initial ghost: zero-width rect at click point (snapped to day).
      const xSnap = Math.round(x / ppd) * ppd;
      setPaintRect({
        left: xSnap,
        top: rowTop,
        width: ppd,
        height: ROW_HEIGHT,
      });
      window.addEventListener("pointermove", onPaintPointerMove);
      window.addEventListener("pointerup", onPaintPointerUp);
    },
    [laneLayout, onPaintPointerMove, onPaintPointerUp, ppd],
  );

  // Plan #16b-γ-G G7 — draggable NEW CARD chip in the header. Same dialog
  // prefill model as G3 drag-paint, just sourced from the chip rather
  // than the canvas. Click (delta < 4px) → empty dialog (existing chip
  // behavior). Drag onto canvas → dialog with start/target/parent/board
  // prefilled. Drag off-canvas → cancel.
  const CHIP_DRAG_THRESHOLD_PX = 4;
  const onChipPointerMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const onChipPointerUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  const finishChipDrag = useCallback(
    (mode: "drop" | "cancel") => {
      const moveHandler = onChipPointerMoveRef.current;
      const upHandler = onChipPointerUpRef.current;
      if (moveHandler) window.removeEventListener("pointermove", moveHandler);
      if (upHandler) window.removeEventListener("pointerup", upHandler);
      const c = chipDragRef.current;
      chipDragRef.current = null;
      setChipGhost(null);
      setChipHoverLaneId(null);
      if (!c) return;
      if (mode === "cancel") return;
      // mode === "drop": decide click vs canvas drop
      if (c.over !== null) {
        const startDays = Math.max(0, Math.round(c.over.canvasX / ppd));
        const startISO = addDays(gridStart, startDays).toISOString().slice(0, 10);
        const targetISO = addDays(gridStart, startDays + 7)
          .toISOString()
          .slice(0, 10);
        setNewCardDefaults({
          start: startISO,
          target: targetISO,
          board: c.over.row.boardId ?? undefined,
          parent: c.over.row.epicId,
        });
        setNewCardOpen(true);
      }
      // If `c.over === null`, the gesture was either an in-place click
      // (no drag) or a release outside the canvas. Click is handled by
      // the chip's pointerdown helper below (it checks delta and opens
      // an empty dialog); off-canvas release is a no-op.
    },
    [gridStart, ppd],
  );

  const onChipPointerMove = useCallback(
    (e: PointerEvent) => {
      const c = chipDragRef.current;
      if (!c) return;
      setChipGhost({ clientX: e.clientX, clientY: e.clientY });
      // Hit-test against the canvas. We use the scroller rect for the
      // visible viewport and the canvas rect for canvas-local
      // coordinates (the canvas is wider than the scroller because of
      // horizontal scroll).
      const scroller = scrollerRef.current;
      const canvas = canvasRef.current;
      if (!scroller || !canvas) {
        c.over = null;
        setChipHoverLaneId(null);
        return;
      }
      const sRect = scroller.getBoundingClientRect();
      if (
        e.clientX < sRect.left ||
        e.clientX > sRect.right ||
        e.clientY < sRect.top ||
        e.clientY > sRect.bottom
      ) {
        c.over = null;
        setChipHoverLaneId(null);
        return;
      }
      const cRect = canvas.getBoundingClientRect();
      const x = e.clientX - cRect.left;
      const y = e.clientY - cRect.top;
      const ll = laneLayoutRef.current.find(
        (entry) => y >= entry.top && y < entry.top + entry.height,
      );
      if (!ll) {
        c.over = null;
        setChipHoverLaneId(null);
        return;
      }
      // Match the G3 paint convention: skip the lane's header strip so
      // a release "above" the bars still creates inside the lane body.
      const bodyTop = ll.top + LANE_HEADER_HEIGHT;
      const yInBody = Math.max(0, y - bodyTop);
      const rowIdx = Math.floor(yInBody / ROW_HEIGHT);
      const rowTop = bodyTop + rowIdx * ROW_HEIGHT;
      const epic = ll.lane.headerCard;
      const epicBoardId = epic
        ? storeCardsRef.current.find((cc) => cc.id === epic.id)?.boardId ?? null
        : null;
      c.over = {
        row: {
          top: rowTop,
          height: ROW_HEIGHT,
          laneId: ll.lane.id,
          epicId: epic?.id ?? null,
          boardId: epicBoardId,
        },
        canvasX: x,
      };
      setChipHoverLaneId(ll.lane.id);
    },
    [],
  );
  onChipPointerMoveRef.current = onChipPointerMove;

  const onChipPointerUp = useCallback(
    (e: PointerEvent) => {
      const c = chipDragRef.current;
      if (!c) {
        finishChipDrag("cancel");
        return;
      }
      const dx = e.clientX - c.startClientX;
      const dy = e.clientY - c.startClientY;
      const moved = Math.hypot(dx, dy) >= CHIP_DRAG_THRESHOLD_PX;
      if (!moved) {
        // Treated as a click: empty dialog (D2/existing chip behavior).
        finishChipDrag("cancel");
        setNewCardDefaults(null);
        setNewCardOpen(true);
        return;
      }
      if (c.over === null) {
        // Released outside canvas after dragging — silent cancel.
        finishChipDrag("cancel");
        return;
      }
      finishChipDrag("drop");
    },
    [finishChipDrag],
  );
  onChipPointerUpRef.current = onChipPointerUp;

  const onChipDragStart = useCallback(
    (clientX: number, clientY: number) => {
      chipDragRef.current = {
        startClientX: clientX,
        startClientY: clientY,
        over: null,
      };
      setChipGhost({ clientX, clientY });
      window.addEventListener("pointermove", onChipPointerMove);
      window.addEventListener("pointerup", onChipPointerUp);
    },
    [onChipPointerMove, onChipPointerUp],
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

  // Cleanup any dangling listeners if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onRowPointerMove);
      window.removeEventListener("pointerup", onRowPointerUp);
      window.removeEventListener("pointermove", onPaintPointerMove);
      const upHandler = onPaintPointerUpRef.current;
      if (upHandler) window.removeEventListener("pointerup", upHandler);
      // Plan #16b-γ-G G7 — chip drag listeners.
      const chipMoveHandler = onChipPointerMoveRef.current;
      const chipUpHandler = onChipPointerUpRef.current;
      if (chipMoveHandler)
        window.removeEventListener("pointermove", chipMoveHandler);
      if (chipUpHandler)
        window.removeEventListener("pointerup", chipUpHandler);
      stopAutoScroll();
    };
  }, [
    onPointerMove,
    onPointerUp,
    onRowPointerMove,
    onRowPointerUp,
    onPaintPointerMove,
    stopAutoScroll,
  ]);

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
        // Plan #16b-γ-G G7 — cancel an in-progress chip drag. Same
        // priority handling as G3 paint: chip-cancel beats search-clear.
        if (chipDragRef.current) {
          finishChipDrag("cancel");
          e.preventDefault();
          return;
        }
        // Plan #16b-γ-G G3 — cancel an in-progress drag-paint. Takes
        // priority over the search-clear so a paint that overlaps a
        // populated search box still cancels cleanly.
        if (paintRef.current) {
          finishPaint(true);
          e.preventDefault();
          return;
        }
        // Plan #16b-γ-G G1 — cancel an in-progress row drag.
        if (rowDragRef.current) {
          rowDragRef.current = null;
          setRowDragGhost(null);
          window.removeEventListener("pointermove", onRowPointerMove);
          window.removeEventListener("pointerup", onRowPointerUp);
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
  }, [queryDraft, newCardOpen, shortcutsOpen, zoom, finishPaint, finishChipDrag, onRowPointerMove, onRowPointerUp]);

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
        onChipDragStart={onChipDragStart}
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
            <p className="serif-display text-4xl">No scheduled work yet.</p>
            <p className="text-sm text-fg-muted">
              Open any epic or story and set a start + target date in the
              Roadmap section of its card modal. Your bars will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="flex border border-hairline rounded-xl overflow-hidden"
          data-testid="roadmap-grid"
        >
          {/* Lane labels (sticky) */}
          <div
            ref={labelPanelRef}
            className="shrink-0 border-r border-hairline bg-[color:var(--surface)] relative"
            style={{ width: LANE_LABEL_WIDTH }}
          >
            {/* Plan #16b-γ-G G4 — priority gutter. Sticky-positioned
                inside the lane-label panel (which itself doesn't scroll
                horizontally with canvas content). 64px overlay over the
                leftmost slice of the panel. Visible only when toggled
                on; bars are tinted by priority regardless. The ref lets
                pointermove hit-test against gutter bounds. */}
            {gutterOn && (
              <PriorityGutter
                ref={gutterRef}
                height={HEADER_STRIP_HEIGHT + totalHeight}
                hoveredBand={hoveredGutterBand}
              />
            )}
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
                rowDragGhost !== null && epicHeader?.id === rowDragGhost.cardId;
              return (
                <div
                  key={ll.lane.id}
                  className={`group relative border-b border-hairline pl-7 pr-3 flex flex-col justify-center ${
                    isDragging ? "opacity-40" : ""
                  }`}
                  style={{ height: ll.height }}
                  data-testid="roadmap-lane-row"
                  data-card-id={epicHeader?.id}
                >
                  {draggable && epicHeader && (
                    <RoadmapRowHandle
                      cardId={epicHeader.id}
                      onDragStart={beginRowDrag}
                    />
                  )}
                  {epicHeader ? (
                    <Link
                      href={`/b/${epicHeader.boardId}/c/${epicHeader.id}`}
                      className="mono-meta text-fg truncate hover:underline focus:outline-none focus:underline"
                      data-testid="roadmap-lane-title-link"
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
                    {ll.lane.kind === "uncategorized"
                      ? `${ll.placed.length} ORPHANS`
                      : ll.lane.kind === "assignee"
                        ? `${ll.placed.length} CARDS`
                        : ll.lane.kind === "component"
                          ? `${ll.placed.length} CARDS`
                          : `${ll.placed.length} STORIES`}
                  </span>
                </div>
              );
            })}
            {/* Plan #16b-γ-G G1 — drop indicator overlay during a row
                drag. Renders a thin line at the resolved insertion
                point. */}
            {rowDragGhost !== null && (() => {
              const lanes = rowDragLanesRef.current;
              if (lanes.length === 0) return null;
              const idx = rowDragGhost.insertIndex;
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
              onPointerDown={onCanvasEmptyPointerDown}
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
              {/* Plan #16b-γ-G G2 — destination-lane highlight while a
                  bar is being dragged across lanes. Only renders when
                  the cursor is over a lane different from the source.
                  Sits below the bar layer (rendered next) so the bar
                  remains fully readable while it crosses. */}
              {dragHoverLaneId !== null &&
                laneLayout
                  .filter((ll) => ll.lane.id === dragHoverLaneId)
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
              {chipHoverLaneId !== null &&
                laneLayout
                  .filter((ll) => ll.lane.id === chipHoverLaneId)
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
              {snapPreview &&
                (() => {
                  const x = xForDate(snapPreview.date, gridStart, ppd);
                  return (
                    <>
                      <div
                        data-testid="roadmap-snap-guide"
                        data-snap-kind={snapPreview.kind}
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
                        data-snap-kind={snapPreview.kind}
                        aria-hidden
                        className="absolute pointer-events-none mono-meta-sm text-fg-muted bg-[color:var(--surface-strong)] px-1.5 py-0.5 rounded chip"
                        style={{
                          left: x + 4,
                          top: HEADER_STRIP_HEIGHT + 4,
                        }}
                      >
                        → {snapPreview.label}
                      </div>
                    </>
                  );
                })()}
              {/* Sprint overlay (under the bar layer) */}
              <SprintOverlay
                zoom={zoom}
                gridStart={gridStart}
                gridEnd={gridEnd}
                height={totalHeight}
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
                              onClick={() =>
                                handleOpenCard(sc.id, sc.boardId)
                              }
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
                        onOpen={handleOpenCard}
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
              {paintRect && (
                <div
                  data-testid="roadmap-paint-ghost"
                  aria-hidden
                  className="absolute pointer-events-none border-2 border-dashed border-fg/40 bg-fg/[0.05]"
                  style={{
                    left: paintRect.left,
                    top: paintRect.top,
                    width: paintRect.width,
                    height: paintRect.height,
                  }}
                />
              )}
            </div>
          </div>
        </div>
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
      {chipGhost && (
        <div
          data-testid="roadmap-chip-ghost"
          aria-hidden
          className="fixed pointer-events-none chip mono-meta-sm bg-fg/10 ring-1 ring-fg/40 z-50"
          style={{
            left: chipGhost.clientX + 12,
            top: chipGhost.clientY + 12,
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
