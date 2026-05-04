"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type MutableRefObject,
  type RefObject,
} from "react";
import { toast } from "sonner";
import type { RoadmapCard, RoadmapLink } from "@/lib/queries/roadmap";
import {
  addDays,
  dayDiff,
  startOfDay,
} from "@/lib/roadmap/dates";
import type { Lane, PlacedCard } from "@/lib/roadmap/layout";
import { updateCard, reorderRoadmapRow } from "@/actions/cards";
import { errorBus } from "@/lib/errors/error-bus";
import { PRIORITIES } from "./priority-gutter";
import type { CardPriority } from "@/components/board/card/priority-picker";
import type { LaneMode } from "./roadmap-header";
import type { CascadeAffectedCard } from "./cascade-confirm-dialog";

// Plan #16b-γ-G aggregate review I2 — drag-harness extraction. All five
// roadmap drag systems live here so `roadmap-view.tsx` becomes
// orchestration + render only.
//
// Owned drag systems:
//   1. Bar drag (move/resize/snap + lane-crossing reparent + priority gutter)
//   2. Paint drag (empty-area drag-paint to create card)
//   3. Chip drag (header NEW CARD chip dragged onto canvas)
//   4. Row drag (row-handle reorder via sparse-rank)
//   5. Auto-scroll RAF loop driven by any active drag

export type DragMode = "move" | "resize-left" | "resize-right";

export type LaneLayoutSnapshot = {
  lane: Lane<RoadmapCard>;
  placed: PlacedCard<RoadmapCard>[];
  top: number;
  height: number;
  headerRows: number;
  bodyRows: number;
  expandedExtraByParent: Map<string, number>;
};

type Sprint = {
  id: string;
  name: string;
  endDate: Date | string | null;
};

// Minimal subset of the workspace-store Card we read inside the harness.
// Date fields can arrive as either Date (after store hydration) or string
// (raw CDC payload) — we normalize via instanceof checks at call sites.
type StoreCard = {
  id: string;
  boardId: string;
  parentCardId: string | null;
  priority: CardPriority | null;
  startDate: Date | null;
  targetDate: Date | null;
  roadmapOrder: number | null;
  title: string;
};

export type PaintRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SnapPreview = {
  date: Date;
  label: string;
  kind: "monday" | "sprint" | "blocker";
};

export type RowDragGhost = {
  cardId: string;
  laneIndex: number;
  currentY: number;
  insertIndex: number;
};

type DragState = {
  cardId: string;
  mode: DragMode;
  startClientX: number;
  origStart: Date;
  origTarget: Date;
  // Only populated in epic + move mode for cross-lane reparent.
  sourceLaneId: string | null;
  currentLaneId: string | null;
  // Priority-gutter mode.
  gutterBand: CardPriority | null;
  origPriority: CardPriority | null;
  // True once the pointer crossed a small movement threshold during the
  // drag. Distinguishes a real drag-and-return-to-origin from a true
  // click — the former should NOT open the card modal on pointerup.
  moved: boolean;
};

type RowDragState = {
  cardId: string;
  boardId: string;
  laneIndex: number;
  startClientY: number;
};

export interface RoadmapDragHarnessInput {
  ppd: number;
  gridStart: Date;
  // Layout constants.
  LANE_HEADER_HEIGHT: number;
  ROW_HEIGHT: number;
  HEADER_STRIP_HEIGHT: number;
  // Lane layout structure (current snapshot — used by beginRowDrag) and a
  // ref so pointermove handlers can read the latest without re-binding.
  laneLayout: LaneLayoutSnapshot[];
  laneLayoutRef: MutableRefObject<LaneLayoutSnapshot[]>;
  // Refs used to read fresh store data inside drag handlers without
  // re-binding window listeners on every pointermove.
  cardsRef: MutableRefObject<RoadmapCard[]>;
  storeCardsRef: MutableRefObject<StoreCard[]>;
  storeLinksRef: MutableRefObject<RoadmapLink[] | { fromCardId: string; toCardId: string; kind: string }[]>;
  storeSprintsRef: MutableRefObject<Sprint[]>;
  // DOM refs (owned by parent).
  scrollerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  labelPanelRef: RefObject<HTMLDivElement | null>;
  gutterRef: RefObject<HTMLDivElement | null>;
  // Mutators (owned by parent — the workspace store).
  patchCardInStore: (id: string, patch: Partial<StoreCard>) => void;
  // Mode + feature flags.
  laneMode: LaneMode;
  gutterOnRef: MutableRefObject<boolean>;
  autoCascadeRef: MutableRefObject<boolean>;
  // External callbacks the parent owns.
  onCascadeNeeded: (info: {
    rootCardId: string;
    deltaDays: number;
    affected: CascadeAffectedCard[];
  }) => void;
  onOpenNewCardDialog: (defaults: {
    start?: string;
    target?: string;
    board?: string;
    parent?: string | null;
  } | null) => void;
  onOpenCard: (cardId: string, boardId: string) => void;
}

export interface RoadmapDragHarnessOutput {
  // Pointer-event entry points.
  onCanvasEmptyPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  beginBarDrag: (mode: DragMode, e: React.PointerEvent, cardId: string) => void;
  beginRowDrag: (cardId: string, e: React.PointerEvent) => void;
  onChipDragStart: (clientX: number, clientY: number) => void;
  // State the parent renders.
  paintRect: PaintRect | null;
  chipGhost: { clientX: number; clientY: number } | null;
  snapPreview: SnapPreview | null;
  dragHoverLaneId: string | null;
  chipHoverLaneId: string | null;
  hoveredGutterBand: CardPriority | null;
  rowDragGhost: RowDragGhost | null;
  rowDragLanesRef: MutableRefObject<
    Array<{
      laneIndex: number;
      cardId: string | null;
      boardId: string | null;
      top: number;
      height: number;
    }>
  >;
  isDragging: boolean;
  // Esc cancellation hook — returns true if it cancelled something.
  cancelActiveDrag: () => boolean;
}

const PAINT_THRESHOLD_PX = 4;
const CHIP_DRAG_THRESHOLD_PX = 4;

export function useRoadmapDragHarness(
  input: RoadmapDragHarnessInput,
): RoadmapDragHarnessOutput {
  const {
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
  } = input;

  const [, startTransition] = useTransition();

  // ---- Bar drag state ----
  const dragRef = useRef<DragState | null>(null);
  const [dragHoverLaneId, setDragHoverLaneId] = useState<string | null>(null);
  const dragSourceLaneIdRef = useRef<string | null>(null);
  const [hoveredGutterBand, setHoveredGutterBand] =
    useState<CardPriority | null>(null);
  const lastAltKeyRef = useRef(false);
  const dragBlockerTargetsRef = useRef<
    Array<{ date: Date; cardTitle: string }>
  >([]);
  const dragSprintEndsRef = useRef<Array<{ date: Date; name: string }>>([]);
  const [snapPreview, setSnapPreview] = useState<SnapPreview | null>(null);
  const snapPreviewRef = useRef<SnapPreview | null>(snapPreview);
  snapPreviewRef.current = snapPreview;

  // ---- Auto-scroll state ----
  const lastClientXRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);

  // ---- Paint drag state ----
  const paintRef = useRef<{
    startClientX: number;
    startCanvasX: number;
    currentCanvasX: number;
    row: {
      top: number;
      height: number;
      laneId: string;
      epicId: string | null;
      boardId: string | null;
    };
  } | null>(null);
  const [paintRect, setPaintRect] = useState<PaintRect | null>(null);
  const onPaintPointerUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  // ---- Chip drag state ----
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
  const [chipHoverLaneId, setChipHoverLaneId] = useState<string | null>(null);
  const onChipPointerMoveRef = useRef<((e: PointerEvent) => void) | null>(null);
  const onChipPointerUpRef = useRef<((e: PointerEvent) => void) | null>(null);

  // ---- Row drag state ----
  const rowDragRef = useRef<RowDragState | null>(null);
  const [rowDragGhost, setRowDragGhost] = useState<RowDragGhost | null>(null);
  const rowDragGhostRef = useRef<RowDragGhost | null>(rowDragGhost);
  rowDragGhostRef.current = rowDragGhost;
  const rowDragLanesRef = useRef<
    Array<{
      laneIndex: number;
      cardId: string | null;
      boardId: string | null;
      top: number;
      height: number;
    }>
  >([]);

  // ---- Cascade dependent collection (moved here so persistDates can call it) ----
  const collectDependents = useCallback(
    (rootId: string): CascadeAffectedCard[] => {
      const cardById = new Map(storeCardsRef.current.map((c) => [c.id, c]));
      const visited = new Set<string>([rootId]);
      const out: CascadeAffectedCard[] = [];
      let frontier: string[] = [rootId];
      for (let depth = 0; depth < 50; depth++) {
        if (frontier.length === 0) break;
        const next: string[] = [];
        for (const l of storeLinksRef.current as Array<{
          fromCardId: string;
          toCardId: string;
          kind: string;
        }>) {
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
    [storeCardsRef, storeLinksRef],
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
        const targetDeltaMs = next.target.getTime() - orig.target.getTime();
        const deltaDays = Math.round(targetDeltaMs / 86_400_000);
        if (autoCascadeRef.current && deltaDays > 0) {
          const affected = collectDependents(cardId);
          if (affected.length > 0) {
            onCascadeNeeded({ rootCardId: cardId, deltaDays, affected });
          }
        }
        // Don't manually re-set the store: the realtime CDC echo will
        // reconcile via `useWorkspaceRealtime`.
      } catch (err) {
        // Revert the optimistic patch on failure.
        patchCardInStore(cardId, {
          startDate: orig.start,
          targetDate: orig.target,
        });
        toast.error((err as Error).message);
      }
    },
    [patchCardInStore, collectDependents, autoCascadeRef, onCascadeNeeded],
  );

  // ---- Auto-scroll ----
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
    const HOT = 60;
    const MAX_PX = 12;
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

  // ---- Snap helpers ----
  const snapDateWithSource = useCallback(
    (
      d: Date,
      includeBlockers: boolean,
    ): SnapPreview | null => {
      type Cand = SnapPreview;
      const candidates: Cand[] = [];
      const day = d.getUTCDay();
      const sinceMonday = (day + 6) % 7;
      const prevMonday = addDays(startOfDay(d), -sinceMonday);
      const nextMonday = addDays(prevMonday, 7);
      candidates.push(
        { date: prevMonday, kind: "monday", label: "Mon" },
        { date: nextMonday, kind: "monday", label: "Mon" },
      );
      for (const s of dragSprintEndsRef.current) {
        candidates.push({
          date: s.date,
          kind: "sprint",
          label: `${s.name} end`,
        });
      }
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

  const snapDate = useCallback(
    (d: Date, extraCandidates: Date[] = []): Date => {
      const candidates: Date[] = [...extraCandidates];
      const day = d.getUTCDay();
      const sinceMonday = (day + 6) % 7;
      const prevMonday = addDays(startOfDay(d), -sinceMonday);
      const nextMonday = addDays(prevMonday, 7);
      candidates.push(prevMonday, nextMonday);
      for (const s of storeSprintsRef.current) {
        if (s.endDate) {
          candidates.push(
            startOfDay(
              s.endDate instanceof Date ? s.endDate : new Date(s.endDate),
            ),
          );
        }
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
    [storeSprintsRef],
  );

  // ---- Bar drag pointermove ----
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      lastClientXRef.current = e.clientX;
      lastAltKeyRef.current = e.altKey;
      // Stamp `moved` once the pointer has crossed a small threshold so
      // pointerup can distinguish a real drag-and-return-to-origin from
      // an unintended click.
      if (!d.moved && Math.abs(e.clientX - d.startClientX) > 4) {
        d.moved = true;
      }

      // Gutter detection (move + gutter on).
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
            if (d.currentLaneId !== d.sourceLaneId) {
              d.currentLaneId = d.sourceLaneId;
              setDragHoverLaneId(null);
            }
            patchCardInStore(d.cardId, {
              startDate: d.origStart,
              targetDate: d.origTarget,
            });
            if (autoScrollRafRef.current === null) {
              autoScrollRafRef.current =
                requestAnimationFrame(tickAutoScroll);
            }
            return;
          }
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
      patchCardInStore(d.cardId, {
        startDate: nextStart,
        targetDate: nextTarget,
      });
      // Vertical hit-test for cross-lane reparent (epic + move only).
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
            const highlight =
              nextLaneId !== null && nextLaneId !== d.sourceLaneId
                ? nextLaneId
                : null;
            setDragHoverLaneId(highlight);
          }
        }
      }
      // Snap preview.
      const currentPreview = snapPreviewRef.current;
      if (d.gutterBand !== null || e.altKey) {
        if (currentPreview !== null) setSnapPreview(null);
      } else {
        let preview: SnapPreview | null = null;
        if (d.mode === "resize-left") {
          preview = snapDateWithSource(startOfDay(nextStart), true);
        } else if (d.mode === "resize-right") {
          preview = snapDateWithSource(startOfDay(nextTarget), false);
        } else {
          const startCand = snapDateWithSource(startOfDay(nextStart), true);
          const targetCand = snapDateWithSource(startOfDay(nextTarget), false);
          const startDelta = startCand
            ? Math.abs(dayDiff(startOfDay(nextStart), startCand.date))
            : Number.POSITIVE_INFINITY;
          const targetDelta = targetCand
            ? Math.abs(dayDiff(startOfDay(nextTarget), targetCand.date))
            : Number.POSITIVE_INFINITY;
          preview = startDelta <= targetDelta ? startCand : targetCand;
        }
        const same =
          (preview === null && currentPreview === null) ||
          (preview !== null &&
            currentPreview !== null &&
            preview.date.getTime() === currentPreview.date.getTime() &&
            preview.kind === currentPreview.kind &&
            preview.label === currentPreview.label);
        if (!same) setSnapPreview(preview);
      }
      if (autoScrollRafRef.current === null) {
        autoScrollRafRef.current = requestAnimationFrame(tickAutoScroll);
      }
    },
    [
      ppd,
      patchCardInStore,
      tickAutoScroll,
      snapDateWithSource,
      gutterOnRef,
      gutterRef,
      canvasRef,
      laneLayoutRef,
    ],
  );

  // ---- Bar drag pointerup ----
  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
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

    // Gutter mode → write priority.
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
    // Cross-lane reparent detection (epic + move only).
    const reparented =
      d.mode === "move" &&
      d.sourceLaneId !== null &&
      d.currentLaneId !== null &&
      d.currentLaneId !== d.sourceLaneId;
    const noOp =
      current.startDate.getTime() === d.origStart.getTime() &&
      current.targetDate.getTime() === d.origTarget.getTime();
    if (noOp && !reparented) {
      // A1 — no-movement = click → open card. Only fire when the pointer
      // never crossed the movement threshold; otherwise the user
      // genuinely dragged and returned to origin (treat as cancelled).
      if (d.mode === "move" && !d.moved) {
        onOpenCard(d.cardId, current.boardId);
      }
      return;
    }
    if (reparented) {
      const targetLane = laneLayoutRef.current.find(
        (ll) => ll.lane.id === d.currentLaneId,
      );
      const targetEpicId = targetLane?.lane.headerCard?.id ?? null;
      const targetTitle =
        targetLane?.lane.title ??
        (targetEpicId ? "destination" : "Uncategorized");
      const origCard = storeCardsRef.current.find((c) => c.id === d.cardId);
      const origParentId = origCard?.parentCardId ?? null;
      patchCardInStore(d.cardId, { parentCardId: targetEpicId });
      const cardId = d.cardId;
      startTransition(() => {
        void (async () => {
          try {
            await updateCard({ id: cardId, parentCardId: targetEpicId });
          } catch (err) {
            patchCardInStore(cardId, { parentCardId: origParentId });
            const raw = (err as Error).message ?? "Reparent failed";
            const isCycle = raw.startsWith("PARENT_CYCLE");
            const message = isCycle
              ? `Cannot move card under ${targetTitle} — cycle detected.`
              : `Reparent failed: ${raw}`;
            errorBus.push({ message });
          }
        })();
      });
    }
    if (noOp) return;

    // Blocker target_dates for START-edge snap.
    const blockerCardIds = (
      storeLinksRef.current as Array<{
        fromCardId: string;
        toCardId: string;
        kind: string;
      }>
    )
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
  }, [
    onPointerMove,
    persistDates,
    snapDate,
    patchCardInStore,
    onOpenCard,
    stopAutoScroll,
    cardsRef,
    storeCardsRef,
    storeLinksRef,
    laneLayoutRef,
  ]);

  const beginBarDrag = useCallback(
    (mode: DragMode, e: React.PointerEvent, cardId: string) => {
      const c = cardsRef.current.find((x) => x.id === cardId);
      if (!c) return;
      e.preventDefault();
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
        moved: false,
      };
      const sprintEnds: Array<{ date: Date; name: string }> = [];
      for (const s of storeSprintsRef.current) {
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
      const blockerCardIds = (
        storeLinksRef.current as Array<{
          fromCardId: string;
          toCardId: string;
          kind: string;
        }>
      )
        .filter((l) => l.fromCardId === cardId && l.kind === "is_blocked_by")
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
    [
      laneMode,
      onPointerMove,
      onPointerUp,
      cardsRef,
      laneLayoutRef,
      storeSprintsRef,
      storeLinksRef,
      storeCardsRef,
    ],
  );

  // ---- Row drag ----
  const onRowPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = rowDragRef.current;
      if (!drag) return;
      const lanes = rowDragLanesRef.current;
      if (lanes.length === 0) return;
      const y = e.clientY;
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
    },
    [labelPanelRef],
  );

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

    const neighbours = lanes.filter(
      (ln) => ln.laneIndex !== drag.laneIndex && ln.cardId !== null,
    );
    const insertIdx = ghost.insertIndex;
    let neighbourSlot = 0;
    for (let i = 0; i < insertIdx; i++) {
      const ln = lanes[i];
      if (ln.laneIndex === drag.laneIndex) continue;
      neighbourSlot++;
    }
    const beforeId =
      neighbourSlot > 0 ? neighbours[neighbourSlot - 1].cardId : null;
    const afterId =
      neighbourSlot < neighbours.length
        ? neighbours[neighbourSlot].cardId
        : null;

    if (beforeId === null && afterId === null) return;
    const origIdx = lanes.findIndex((ln) => ln.cardId === drag.cardId);
    const origNeighbourBefore =
      origIdx > 0
        ? lanes
            .slice(0, origIdx)
            .reverse()
            .find(
              (ln) => ln.cardId !== null && ln.laneIndex !== drag.laneIndex,
            )?.cardId ?? null
        : null;
    if (
      beforeId === origNeighbourBefore &&
      afterId !== null &&
      origIdx < lanes.findIndex((ln) => ln.cardId === afterId)
    ) {
      return;
    }

    const cardId = drag.cardId;
    const boardId = drag.boardId;
    const origCard = storeCardsRef.current.find((c) => c.id === cardId);
    const origRoadmapOrder = origCard?.roadmapOrder ?? null;

    const beforeOrd = beforeId
      ? storeCardsRef.current.find((c) => c.id === beforeId)?.roadmapOrder ??
        null
      : null;
    const afterOrd = afterId
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
  }, [onRowPointerMove, patchCardInStore, storeCardsRef]);

  const beginRowDrag = useCallback(
    (cardId: string, e: React.PointerEvent) => {
      if (laneMode !== "epic") return;
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
    [
      laneLayout,
      laneMode,
      onRowPointerMove,
      onRowPointerUp,
      labelPanelRef,
      HEADER_STRIP_HEIGHT,
      storeCardsRef,
    ],
  );

  // ---- Paint drag ----
  const onPaintPointerMove = useCallback(
    (e: PointerEvent) => {
      const p = paintRef.current;
      if (!p) return;
      const deltaPx = e.clientX - p.startClientX;
      const newCanvasX = p.startCanvasX + deltaPx;
      p.currentCanvasX = newCanvasX;
      const aSnap = Math.round(p.startCanvasX / ppd) * ppd;
      const bSnap = Math.round(newCanvasX / ppd) * ppd;
      const left = Math.min(aSnap, bSnap);
      const right = Math.max(aSnap, bSnap);
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
      const epicBoardId = p.row.boardId;
      if (deltaPx < PAINT_THRESHOLD_PX) {
        onOpenNewCardDialog({
          start: startISO,
          board: epicBoardId ?? undefined,
          parent: p.row.epicId,
        });
      } else {
        onOpenNewCardDialog({
          start: startISO,
          target: endISO,
          board: epicBoardId ?? undefined,
          parent: p.row.epicId,
        });
      }
    },
    [gridStart, onPaintPointerMove, ppd, onOpenNewCardDialog],
  );

  const onPaintPointerUp = useCallback(() => {
    finishPaint(false);
  }, [finishPaint]);
  onPaintPointerUpRef.current = onPaintPointerUp;

  const onCanvasEmptyPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      // Bail if the pointerdown landed on a known interactive descendant
      // (bar, row handle). Decorative children — vertical grid lines,
      // lane separators, header strip text — are pointer-events-default
      // but rendering empty so they may swallow `e.target` even though the
      // user's intent is "empty area paint". Walking from `e.target` up
      // until we either hit one of those decoys (continue) or a real
      // interactive element (bail) is more reliable than `e.target ===
      // e.currentTarget`, which fails when divs without `pointer-events:
      // none` happen to sit under the cursor.
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-testid="roadmap-bar"]')) return;
      if (t && t.closest('[data-testid="roadmap-row-handle"]')) return;
      if (t && t.closest('[data-testid="roadmap-bar-overflow"]')) return;
      // Bail when pointerdown originates inside any floating UI rendered
      // over the canvas (context menu, dialog, dropdown, popover). These
      // are sometimes nested in the canvas DOM (fixed-position menu) or
      // sit logically above it; either way, clicks belong to that UI,
      // not to a canvas paint operation.
      if (t && t.closest('[role="menu"]')) return;
      if (t && t.closest('[role="dialog"]')) return;
      if (t && t.closest('[data-slot="dialog-content"]')) return;
      if (t && t.closest('[data-slot="dialog-overlay"]')) return;
      if (t && t.closest('[data-slot="dropdown-menu-content"]')) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ll = laneLayout.find(
        (entry) => y >= entry.top && y < entry.top + entry.height,
      );
      if (!ll) return;
      const bodyTop = ll.top + LANE_HEADER_HEIGHT;
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
    [
      laneLayout,
      onPaintPointerMove,
      onPaintPointerUp,
      ppd,
      LANE_HEADER_HEIGHT,
      ROW_HEIGHT,
      storeCardsRef,
    ],
  );

  // ---- Chip drag ----
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
      if (c.over !== null) {
        const startDays = Math.max(0, Math.round(c.over.canvasX / ppd));
        const startISO = addDays(gridStart, startDays).toISOString().slice(0, 10);
        const targetISO = addDays(gridStart, startDays + 7)
          .toISOString()
          .slice(0, 10);
        onOpenNewCardDialog({
          start: startISO,
          target: targetISO,
          board: c.over.row.boardId ?? undefined,
          parent: c.over.row.epicId,
        });
      }
    },
    [gridStart, ppd, onOpenNewCardDialog],
  );

  const onChipPointerMove = useCallback(
    (e: PointerEvent) => {
      const c = chipDragRef.current;
      if (!c) return;
      setChipGhost({ clientX: e.clientX, clientY: e.clientY });
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
    [
      scrollerRef,
      canvasRef,
      laneLayoutRef,
      LANE_HEADER_HEIGHT,
      ROW_HEIGHT,
      storeCardsRef,
    ],
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
        // Click → empty dialog.
        finishChipDrag("cancel");
        onOpenNewCardDialog(null);
        return;
      }
      if (c.over === null) {
        finishChipDrag("cancel");
        return;
      }
      finishChipDrag("drop");
    },
    [finishChipDrag, onOpenNewCardDialog],
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

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onRowPointerMove);
      window.removeEventListener("pointerup", onRowPointerUp);
      window.removeEventListener("pointermove", onPaintPointerMove);
      const upHandler = onPaintPointerUpRef.current;
      if (upHandler) window.removeEventListener("pointerup", upHandler);
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

  // ---- Esc cancellation ----
  const cancelActiveDrag = useCallback((): boolean => {
    if (chipDragRef.current) {
      finishChipDrag("cancel");
      return true;
    }
    if (paintRef.current) {
      finishPaint(true);
      return true;
    }
    if (rowDragRef.current) {
      rowDragRef.current = null;
      setRowDragGhost(null);
      window.removeEventListener("pointermove", onRowPointerMove);
      window.removeEventListener("pointerup", onRowPointerUp);
      return true;
    }
    return false;
  }, [finishChipDrag, finishPaint, onRowPointerMove, onRowPointerUp]);

  const isDragging =
    dragRef.current !== null ||
    paintRef.current !== null ||
    chipDragRef.current !== null ||
    rowDragRef.current !== null;

  return {
    onCanvasEmptyPointerDown,
    beginBarDrag,
    beginRowDrag,
    onChipDragStart,
    paintRect,
    chipGhost,
    snapPreview,
    dragHoverLaneId,
    chipHoverLaneId,
    hoveredGutterBand,
    rowDragGhost,
    rowDragLanesRef,
    isDragging,
    cancelActiveDrag,
  };
}
