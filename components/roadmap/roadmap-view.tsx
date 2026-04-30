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
import { getCardStatusKind, type StatusKind } from "@/lib/roadmap/status";
import { criticalPath, type Link as CritLink } from "@/lib/roadmap/critical-path";
import { updateCard } from "@/actions/cards";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { RoadmapBar } from "./roadmap-bar";
import { DependencyArrows, type BarBox } from "./dependency-arrows";
import { CriticalPathOverlay } from "./critical-path-overlay";
import {
  CascadeConfirmDialog,
  type CascadeAffectedCard,
} from "./cascade-confirm-dialog";
import { SprintOverlay } from "./sprint-overlay";

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
  const focusParam = sp.get("focus");

  // Plan #16b-α (#6 / #4) — flash an outline ring on the focused bar for
  // 1.5s after mount / focus-param change. Cleared when the timeout fires
  // or the param changes again.
  const [flashFocus, setFlashFocus] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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
    // Mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const cards = useMemo<RoadmapCard[]>(() => {
    const boardTitleById = new Map(storeBoards.map((b) => [b.id, b.title]));
    return storeCards
      .filter(
        (c) =>
          !c.archived &&
          c.startDate !== null &&
          c.targetDate !== null,
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

  const lanes = useMemo(() => groupByEpic(cards), [cards]);

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

  // Plan #16b-α (#10) — snap-to-week-Monday + snap-to-sprint-end on
  // pointer release. Window: within 4 days of a candidate snap target,
  // we snap to the nearest one; otherwise the rounded-to-day position
  // (preserved by the drag delta math) is kept as-is. Sprint end_dates
  // come from the workspace store; weeks are computed deterministically
  // off the dragged date itself.
  const snapDate = useCallback(
    (d: Date): Date => {
      const candidates: Date[] = [];
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

    // Apply snap depending on drag mode. In move-mode we snap the
    // edge that's closest to a target, preserving the duration; in
    // resize modes we snap only the dragged edge.
    let snappedStart = startOfDay(current.startDate);
    let snappedTarget = startOfDay(current.targetDate);
    if (d.mode === "resize-left") {
      snappedStart = snapDate(snappedStart);
    } else if (d.mode === "resize-right") {
      snappedTarget = snapDate(snappedTarget);
    } else {
      const startSnap = snapDate(snappedStart);
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
  }, [onPointerMove, persistDates, snapDate, patchCardInStore]);

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
          <button
            type="button"
            onClick={() => setShowCriticalPath((p) => !p)}
            data-testid="roadmap-critical-toggle"
            data-active={showCriticalPath ? "true" : "false"}
            aria-pressed={showCriticalPath}
            className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
              showCriticalPath ? "ring-1 ring-fg/40" : ""
            }`}
          >
            CRITICAL PATH: {showCriticalPath ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={toggleAutoCascade}
            data-testid="roadmap-auto-cascade-toggle"
            data-active={autoCascade ? "true" : "false"}
            aria-pressed={autoCascade}
            title="Reschedule blocked dependents after a forward target_date drag"
            className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
              autoCascade ? "ring-1 ring-fg/40" : ""
            }`}
          >
            AUTO-RESCHEDULE: {autoCascade ? "ON" : "OFF"}
          </button>
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
          <div
            ref={scrollerRef}
            className="flex-1 overflow-x-auto overflow-y-hidden"
            data-testid="roadmap-scroller"
          >
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
                              onDoubleClick={() =>
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
    </div>
  );
}
