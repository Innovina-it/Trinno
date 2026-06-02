"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useShallow } from "zustand/shallow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { RoadmapCard, RoadmapLink } from "@/lib/queries/roadmap";
import {
  addDays,
  dayDiff,
  gridEndFor,
  gridStartFor,
  pixelsPerDay,
  preservedScrollLeft,
  startOfDay,
  xForDate,
  type Zoom,
} from "@/lib/roadmap/dates";
import {
  groupByAssignee,
  groupByComponent,
  groupBySubBoard,
  stackInLane,
  type SubBoardRef,
} from "@/lib/roadmap/layout";
import { holidaysInRange } from "@/lib/holidays/merge";
import { getCardStatusKind, type StatusKind } from "@/lib/status";
import { criticalPath, type Link as CritLink } from "@/lib/roadmap/critical-path";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useIsGuest } from "@/lib/permissions/use-is-guest";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { RoadmapBar, type RoadmapBarAssignee } from "./roadmap-bar";
import { PriorityGutter } from "./priority-gutter";
import { DependencyArrows, type BarBox } from "./dependency-arrows";
import { CriticalPathOverlay } from "./critical-path-overlay";
import {
  CascadeConfirmDialog,
  type CascadeAffectedCard,
} from "./cascade-confirm-dialog";
import { SprintOverlay } from "./sprint-overlay";
import { NewCardDialog as RoadmapNewCardDialog } from "@/components/board/new-card-dialog";
import { RoadmapFilterBar } from "./roadmap-filter-bar";
import { AssigneeFilterRow } from "@/components/filters/assignee-filter-row";
import { RoadmapMiniMap } from "./mini-map";
import { RoadmapRowHandle } from "./roadmap-row-handle";
import { MilestoneMarkers } from "./milestone-markers";
import type { MilestoneRow } from "./milestone-dialog";
import { MilestoneDialog } from "./milestone-dialog";
import { listMilestones } from "@/actions/milestones";
import { createCard, updateCard } from "@/actions/cards";
import { toggleCardMember } from "@/actions/card-members";
import { toast } from "sonner";
import {
  RoadmapHeader,
  ZOOMS,
  LANE_MODES,
  VIEW_MODES,
  type LaneMode,
  type ViewMode,
} from "./roadmap-header";
import { RoadmapListView } from "./roadmap-list-view";
import { BaselineMenu } from "./baselines/baseline-menu";
import { useUserPreferences } from "@/lib/preferences/provider";
import {
  getWorkspacePreferences,
  patchWorkspacePreferences,
} from "@/lib/preferences/scoped";
import {
  CardQuickView,
  type PatchInput as QuickViewPatchInput,
  type QuickViewSubtask,
} from "@/components/board/card-quick-view";
import {
  hasExplicitFilterParams,
  parseFilters,
  preserveNonFilterParams,
  serializeFilters,
} from "@/lib/board-filters";
import { useRoadmapDragHarness } from "./use-roadmap-drag-harness";
import {
  useBoards,
  useMembers,
  useWorkspaceSnapshot,
  workspaceSnapshotKeys,
} from "@/lib/queries/workspace-snapshot-shared";
import {
  logWorkspaceTabSwitchLatency,
  useWorkspaceCacheQueryClient,
} from "@/stores/workspace-cache-store";
import { useWorkspaceFlag } from "@/lib/feature-flags/use-workspace-flag";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import {
  countMineHiddenRoadmapCards,
  roadmapUserFilterPasses,
} from "@/lib/roadmap/filtering";
import {
  rememberRoadmapCardOrigin,
  restoreRoadmapCardOrigin,
  roadmapHref,
} from "@/lib/roadmap/back-nav";
import {
  useRegisterSharedScroller,
  useSharedAxis,
  useSharedDragPpd,
} from "@/lib/roadmap/shared-axis";

const ROW_HEIGHT = 36; // 28px bar + 8px gap
const LANE_HEADER_HEIGHT = 28;
const LANE_GAP = 12;
// Two-row header: date labels (e.g. "May 1") sit in the top ~24px,
// sprint labels (e.g. "SPRINT 15 · ACTIVE") in the bottom ~28px above
// the 4px stripe. Splitting these prevents the previous label collision
// where both rendered into the same 36px slot.
const HEADER_STRIP_HEIGHT = 56;
// Task 9 — responsive lane label panel. Width is driven by a CSS variable
// (`--lane-label-w`) so the panel shrinks on narrow viewports without
// crowding the canvas. The clamp keeps a usable minimum tap-target on
// phones while letting larger screens give the label room to breathe.
const LANE_LABEL_WIDTH_CSS = "clamp(140px, 18vw, 240px)";

function fmtHeader(d: Date, zoom: Zoom): string {
  const monthShort = d.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  if (zoom === "week") {
    const weekday = d.toLocaleString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    });
    return d.getUTCDate() === 1
      ? `${weekday} ${monthShort} ${d.getUTCDate()}`
      : `${weekday} ${d.getUTCDate()}`;
  }
  if (zoom === "month" || zoom === "fit") {
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
  ppd: number,
): { date: Date; x: number }[] {
  const ticks: { date: Date; x: number }[] = [];
  if (zoom === "week") {
    let cur = gridStart;
    while (cur.getTime() <= gridEnd.getTime()) {
      ticks.push({ date: cur, x: xForDate(cur, gridStart, ppd) });
      cur = addDays(cur, 1);
    }
  } else if (zoom === "month" || zoom === "fit") {
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
  viewerId,
  holidays: holidayDefs = [],
  workspaceColumn,
  hideChrome = false,
  onCollapse,
  compactLanes = false,
  fillHeight = false,
}: {
  workspaceId: string;
  /** Used for assignee/unassigned filter. Pass null/undefined for anonymous. */
  viewerId?: string | null;
  /** Effective holiday list (presets merged with workspace overrides).
   *  Server-fetched in the page; defaults to empty for safety. */
  holidays?: ReadonlyArray<{ iso: string; name: string }>;
  /** Set on the cross-workspace /timeline surface to render a narrow column
   *  with the workspace name to the LEFT of the lane label panel. Unset on
   *  the single-workspace /w/:ws/roadmap route. */
  workspaceColumn?: { name: string; href?: string };
  /** Hide the band's own RoadmapHeader, toolbar row (filters, milestones),
   *  and mini-map. Used on /timeline where ONE shared chrome at page level
   *  drives every band; only the grid + canvas remain per band so the page
   *  doesn't stack N copies of the same controls. */
  hideChrome?: boolean;
  /** When set, renders a collapse-to-strip control inside the WS column
   *  header. Click → caller decides what to render in this band's slot
   *  (typically a compact CollapsedBand strip). */
  onCollapse?: () => void;
  /** Greedy-pack non-overlapping cards onto the same lane row instead of
   *  giving every card its own dedicated row. Used on /timeline where the
   *  shared range stretches the canvas so wide that one-row-per-card
   *  produces lanes that are mostly empty vertical space. Default false
   *  preserves /w/:ws/roadmap's top-to-bottom hierarchy reading. */
  compactLanes?: boolean;
  /** Stretch the grid container to fill its parent's height. Used on the
   *  cross-workspace /timeline surface so the last visible band absorbs
   *  leftover viewport space when filters reduce content to a few lanes,
   *  instead of leaving a dark void below a small band. The canvas grows
   *  past `totalHeight`; lane content stays anchored at top, grid lines
   *  and today/milestone markers extend through the empty area. */
  fillHeight?: boolean;
}) {
  // SharedAxisProvider is mounted on /timeline (multiple stacked RoadmapView
  // instances). Absent on /w/:ws/roadmap — falls back to per-band cards-derived
  // range and per-band scroll.
  const sharedAxis = useSharedAxis();
  const isGuest = useIsGuest();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { preferences, setPreferences } = useUserPreferences();
  const workspacePreferences = getWorkspacePreferences(preferences, workspaceId);
  // On the cross-workspace /timeline surface (sharedAxis mounted), URL is
  // the only source of truth for zoom/lanes/view — per-workspace prefs would
  // make each band render at a different scale, breaking the shared axis.
  const useWsPrefs = sharedAxis === null;
  const zoomParam = sp.get("zoom");
  const zoom: Zoom = (ZOOMS as string[]).includes(zoomParam ?? "")
    ? (zoomParam as Zoom)
    : (useWsPrefs ? (workspacePreferences.roadmap?.zoom ?? "fit") : "fit");
  const lanesParam = sp.get("lanes");
  const laneMode: LaneMode = (LANE_MODES as string[]).includes(lanesParam ?? "")
    ? (lanesParam as LaneMode)
    : (useWsPrefs
        ? (workspacePreferences.roadmap?.laneMode ?? "sub_board")
        : "sub_board");
  const viewParam = sp.get("view");
  const viewMode: ViewMode = (VIEW_MODES as string[]).includes(viewParam ?? "")
    ? (viewParam as ViewMode)
    : (useWsPrefs ? (workspacePreferences.roadmap?.viewMode ?? "gantt") : "gantt");
  const focusParam = sp.get("focus");
  const queryParam = sp.get("q") ?? "";
  // Plan #16b-γ-G G4 — priority-gutter URL toggle. URL `?gutter=1`/`?gutter=0`
  // wins when present (so shared links keep their explicit state). When
  // absent, fall back to the workspace pref so a returning user finds the
  // gutter in the same state they left it.
  const gutterParam = sp.get("gutter");
  const gutterOn =
    gutterParam === "1"
      ? true
      : gutterParam === "0"
        ? false
        : useWsPrefs
          ? (workspacePreferences.roadmap?.gutter ?? false)
          : false;

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

  // Seed the URL from persisted workspace roadmap filters on first mount.
  // Mirrors board-view's `savedFilters` rehydration: the URL remains the
  // source of truth during a session, but if the user lands on the
  // roadmap with no filter params (cold reload, fresh sign-in, or
  // cross-device visit) we replay their last applied filters / sprint.
  // Hard URL filter params win — opening a shared link must show that
  // link's exact view, not the recipient's saved one.
  const didSeedFiltersRef = useRef(false);
  useEffect(() => {
    if (didSeedFiltersRef.current) return;
    didSeedFiltersRef.current = true;
    const savedFilters = workspacePreferences.roadmap?.filters;
    const savedSprint = workspacePreferences.roadmap?.sprintFilter;
    if (!savedFilters && !savedSprint) return;
    const params = new URLSearchParams(sp.toString());
    if (hasExplicitFilterParams(params) || params.has("sprint")) return;
    const nextParams = preserveNonFilterParams(
      params,
      savedFilters ? serializeFilters(savedFilters) : new URLSearchParams(),
    );
    if (savedSprint) nextParams.set("sprint", savedSprint);
    const qs = nextParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // Intentionally mount-only; subsequent URL changes shouldn't re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Quick-view popup state. The roadmap lives under
  // /w/[workspaceId]/roadmap while card modals live under /b/[boardId]/c/
  // [cardId] — the parallel-route modal intercept does NOT fire across
  // those parent layouts, so navigating would yield a full page nav.
  // Instead we open the same QuickCardView popup the board uses; its
  // "Open advanced settings" button still navigates to the full route.
  const [quickViewCard, setQuickViewCard] = useState<{
    cardId: string;
    boardId: string;
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

  // Space-to-pan: hold spacebar to swap the scroller into a Photoshop /
  // Figma-style hand tool. While `spacePan` is true the cursor flips to
  // grab and a pointerdown on the scroller starts a horizontal pan
  // instead of bubbling to bar/canvas drag handlers.
  const [spacePan, setSpacePan] = useState(false);
  const spacePanRef = useRef(false);
  spacePanRef.current = spacePan;
  useEffect(() => {
    function isTextTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (e.repeat) {
        if (spacePanRef.current) e.preventDefault();
        return;
      }
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      setSpacePan(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setSpacePan(false);
    }
    function onBlur() {
      // Releasing focus (alt-tab etc.) drops the keyup, so reset to
      // avoid the cursor sticking in grab mode.
      setSpacePan(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Pan-drag bookkeeping for the active gesture.
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);

  const handleScrollerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!spacePanRef.current) return;
      if (e.button !== 0) return;
      const sc = scrollerRef.current;
      if (!sc) return;
      // Capture the gesture: we want subsequent move/up events even if
      // the pointer leaves the scroller bounds.
      sc.setPointerCapture(e.pointerId);
      panRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startScrollLeft: sc.scrollLeft,
      };
      setPanning(true);
      e.preventDefault();
      e.stopPropagation();
    },
    [],
  );

  const handleScrollerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = panRef.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const sc = scrollerRef.current;
      if (!sc) return;
      const dx = e.clientX - p.startX;
      sc.scrollLeft = p.startScrollLeft - dx;
    },
    [],
  );

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const sc = scrollerRef.current;
    if (sc && sc.hasPointerCapture(e.pointerId)) {
      sc.releasePointerCapture(e.pointerId);
    }
    panRef.current = null;
    setPanning(false);
  }, []);

  // Plan #16b-γ-A (#3) — critical-path overlay toggle. Seeded from the
  // workspace's persisted pref so the overlay state is restored on
  // reload / cross-device sign-in. Per-workspace only — on /timeline the
  // shared axis makes a single overlay setting span multiple bands, so
  // we fall back to plain local state.
  const [showCriticalPath, setShowCriticalPath] = useState(() =>
    useWsPrefs ? (workspacePreferences.roadmap?.showCriticalPath ?? false) : false,
  );
  const showCriticalPathFirstRenderRef = useRef(true);
  useEffect(() => {
    if (showCriticalPathFirstRenderRef.current) {
      showCriticalPathFirstRenderRef.current = false;
      return;
    }
    if (!useWsPrefs) return;
    setPreferences((current) =>
      patchWorkspacePreferences(current, workspaceId, {
        roadmap: { showCriticalPath },
      }),
    );
  }, [showCriticalPath, useWsPrefs, workspaceId, setPreferences]);

  // Plan #16b-γ-A (#4) — auto-cascade toggle. Primary store is the
  // workspace pref so the choice follows the user cross-device. Legacy
  // localStorage entries (pre-pref rollout) are read once and promoted
  // into the pref so users don't see the toggle silently reset on first
  // visit after the migration.
  const AUTO_CASCADE_KEY = `roadmap:${workspaceId}:autoCascade`;
  const [autoCascade, setAutoCascade] = useState(() =>
    useWsPrefs && workspacePreferences.roadmap?.autoCascade !== undefined
      ? workspacePreferences.roadmap.autoCascade
      : false,
  );
  const autoCascadeRef = useRef(autoCascade);
  autoCascadeRef.current = autoCascade;
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Skip the rehydrate when the pref already carries an explicit value —
    // the pref is the source of truth.
    if (workspacePreferences.roadmap?.autoCascade !== undefined) return;
    try {
      const raw = window.localStorage.getItem(AUTO_CASCADE_KEY);
      if (raw === "1") {
        setAutoCascade(true);
        if (useWsPrefs) {
          setPreferences((current) =>
            patchWorkspacePreferences(current, workspaceId, {
              roadmap: { autoCascade: true },
            }),
          );
        }
      }
    } catch {
      /* ignore */
    }
  }, [
    AUTO_CASCADE_KEY,
    setPreferences,
    useWsPrefs,
    workspaceId,
    workspacePreferences.roadmap?.autoCascade,
  ]);
  const toggleAutoCascade = useCallback(() => {
    setAutoCascade((p) => {
      const next = !p;
      try {
        window.localStorage.setItem(AUTO_CASCADE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (useWsPrefs) {
        setPreferences((current) =>
          patchWorkspacePreferences(current, workspaceId, {
            roadmap: { autoCascade: next },
          }),
        );
      }
      return next;
    });
  }, [AUTO_CASCADE_KEY, setPreferences, useWsPrefs, workspaceId]);

  // Cascade dialog state.
  const [cascadeState, setCascadeState] = useState<{
    open: boolean;
    rootCardId: string | null;
    deltaDays: number;
    affected: CascadeAffectedCard[];
  }>({ open: false, rootCardId: null, deltaDays: 0, affected: [] });

  const { subscribed } = useWorkspaceRealtime(workspaceId);

  // === MILESTONE MARKERS START ===
  const [storedMilestones, setStoredMilestones] = useState<MilestoneRow[]>([]);
  // Seed from workspace pref so a returning user finds the markers in the
  // same visibility state. Default true = markers visible (matches the
  // prior hard-coded default for fresh accounts).
  const [showMilestones, setShowMilestones] = useState(() =>
    useWsPrefs ? (workspacePreferences.roadmap?.showMilestones ?? true) : true,
  );
  const showMilestonesFirstRenderRef = useRef(true);
  useEffect(() => {
    if (showMilestonesFirstRenderRef.current) {
      showMilestonesFirstRenderRef.current = false;
      return;
    }
    if (!useWsPrefs) return;
    setPreferences((current) =>
      patchWorkspacePreferences(current, workspaceId, {
        roadmap: { showMilestones },
      }),
    );
  }, [showMilestones, useWsPrefs, workspaceId, setPreferences]);
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<MilestoneRow | null>(null);

  useEffect(() => {
    listMilestones(workspaceId).then((rows) => {
      setStoredMilestones(rows as MilestoneRow[]);
    }).catch(() => {/* non-critical */});
  }, [workspaceId]);
  // === MILESTONE MARKERS END (state) ===


  // Read cards directly from the workspace store, projecting to the
  // RoadmapCard shape the layout helpers expect.
  const storeCards = useWorkspaceStore((s) => s.cards);
  const storeBoardsRaw = useWorkspaceStore((s) => s.boards);
  const storeLists = useWorkspaceStore((s) => s.lists);
  const storeLinks = useWorkspaceStore((s) => s.cardLinks);
  const storeSprints = useWorkspaceStore((s) => s.sprints);
  const storeCardMembers = useWorkspaceStore((s) => s.cardMembers);
  const storeProfilesRaw = useWorkspaceStore((s) => s.workspaceProfiles);
  const storeCardComponents = useWorkspaceStore((s) => s.cardComponents);
  const storeComponents = useWorkspaceStore((s) => s.components);
  const storeSubBoards = useWorkspaceStore((s) => s.subBoards);
  const patchCardInStore = useWorkspaceStore((s) => s.patchCard);
  const setCompareBaselineId = useWorkspaceStore((s) => s.setCompareBaselineId);
  const setWorkspaceSnapshot = useWorkspaceStore(
    (s) => s.mergeSnapshotPreservingRealtime,
  );
  const workspaceQueryClient = useWorkspaceCacheQueryClient();
  const sharedSnapshot = useWorkspaceSnapshot(workspaceId);
  const sharedBoards = useBoards(workspaceId);
  const sharedMembers = useMembers(workspaceId);
  const sharedWorkspaceCacheEnabled = useWorkspaceFlag(
    "shared_workspace_cache_v2",
  );
  const storeBoards =
    sharedWorkspaceCacheEnabled && sharedBoards.length > 0
      ? sharedBoards
      : storeBoardsRaw;
  const storeProfiles = useMemo(
    () =>
      sharedWorkspaceCacheEnabled && sharedMembers.length > 0
        ? sharedMembers.map((m) => ({
            id: m.userId,
            displayName: m.displayName,
          }))
        : storeProfilesRaw,
    [sharedMembers, sharedWorkspaceCacheEnabled, storeProfilesRaw],
  );

  useEffect(() => {
    if (!sharedWorkspaceCacheEnabled || !sharedSnapshot) return;
    setWorkspaceSnapshot(sharedSnapshot);
  }, [setWorkspaceSnapshot, sharedSnapshot, sharedWorkspaceCacheEnabled]);

  useEffect(() => {
    const supa = createSupabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supa.channel> | null = null;
    // Per-mount nonce: Supabase JS caches channels by name → StrictMode
    // double-mount returns already-subscribed handle → `.on()` fails.
    const nonce = Math.random().toString(36).slice(2, 8);
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`roadmap_boards:${workspaceId}:${nonce}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "postgres_changes" as any,
          {
            event: "*",
            schema: "public",
            table: "boards",
            filter: `workspace_id=eq.${workspaceId}`,
          },
          () => {
            if (sharedWorkspaceCacheEnabled) {
              void workspaceQueryClient.invalidateQueries({
                queryKey: workspaceSnapshotKeys.workspace(workspaceId),
              });
            }
            router.refresh();
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supa.removeChannel(channel);
    };
  }, [
    router,
    sharedWorkspaceCacheEnabled,
    workspaceId,
    workspaceQueryClient,
  ]);

  useEffect(() => {
    logWorkspaceTabSwitchLatency("roadmap", workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    setPreferences((current) =>
      patchWorkspacePreferences(current, workspaceId, { activeTab: "roadmap" }),
    );
  }, [setPreferences, workspaceId]);

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
  // Per-card assignee profiles for the gantt-bar avatar stack. Built once
  // from `cardMembers` + `workspaceProfiles`; rebuilt only when those store
  // slices change, so RoadmapBar receives stable arrays per card.
  const cardAssigneesById = useMemo(() => {
    const profileById = new Map(storeProfilesRaw.map((p) => [p.id, p]));
    const out = new Map<string, RoadmapBarAssignee[]>();
    for (const cm of storeCardMembers) {
      const p = profileById.get(cm.userId);
      if (!p) continue;
      const arr = out.get(cm.cardId);
      const entry: RoadmapBarAssignee = {
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
      };
      if (arr) arr.push(entry);
      else out.set(cm.cardId, [entry]);
    }
    return out;
  }, [storeCardMembers, storeProfilesRaw]);

  const cards = useMemo<RoadmapCard[]>(() => {
    const boardTitleById = new Map(storeBoards.map((b) => [b.id, b.title]));
    // Build memberByCard index for assignee filters.
    const memberByCard = new Map<string, Set<string>>();
    for (const cm of storeCardMembers) {
      const s = memberByCard.get(cm.cardId) ?? new Set<string>();
      s.add(cm.userId);
      memberByCard.set(cm.cardId, s);
    }
    const now = new Date();
    // Task 11 follow-up — any card that passes the user's filters drags
    // its ancestors along so subtask matches keep a parent row to render
    // under. We compute the pass set first, then expand by walking the
    // parentCardId chain.
    const baseEligible = (c: typeof storeCards[number]) => {
      if (c.archived) return false;
      if (c.startDate === null || c.targetDate === null) return false;
      return true;
    };
    const userFilterPasses = (c: typeof storeCards[number]) =>
      roadmapUserFilterPasses(c, {
        queryNorm,
        filters,
        sprintFilter,
        viewerId,
        memberByCard,
        now,
      });

    const cardById = new Map<string, typeof storeCards[number]>();
    for (const c of storeCards) cardById.set(c.id, c);
    const passSet = new Set<string>();
    for (const c of storeCards) {
      if (!baseEligible(c)) continue;
      if (userFilterPasses(c)) passSet.add(c.id);
    }
    // Pull ancestors of every matching card into the pass set so subtask
    // matches don't render orphaned. Skip ancestors that fail base
    // eligibility (archived / no dates) — they still can't render.
    for (const id of [...passSet]) {
      let cur = cardById.get(id);
      while (cur?.parentCardId) {
        const parent = cardById.get(cur.parentCardId);
        if (!parent) break;
        if (!baseEligible(parent)) break;
        if (passSet.has(parent.id)) break;
        passSet.add(parent.id);
        cur = parent;
      }
    }
    // Pull sub-board anchor cards too. Without this a "Mine" / unassigned
    // filter that excludes the anchor card collapses its sub-board lane —
    // groupBySubBoard then drops the children to orphan self-lanes whose
    // title is the task's own name instead of the anchor's.
    const anchorByBoardId = new Map<string, string>();
    for (const sb of storeSubBoards) {
      if (sb.parentCardId) anchorByBoardId.set(sb.id, sb.parentCardId);
    }
    for (const id of [...passSet]) {
      const c = cardById.get(id);
      if (!c) continue;
      const anchorId = anchorByBoardId.get(c.boardId);
      if (!anchorId || passSet.has(anchorId)) continue;
      const anchor = cardById.get(anchorId);
      if (!anchor || !baseEligible(anchor)) continue;
      passSet.add(anchorId);
    }

    return storeCards
      .filter((c) => passSet.has(c.id))
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
        // completedAt feeds the bar's lime ring + line-through. Was
        // missing — the toggle fired the server call fine, but UI never
        // reflected because the prop was always undefined.
        completedAt:
          c.completedAt
            ? c.completedAt instanceof Date
              ? c.completedAt
              : new Date(c.completedAt)
            : null,
      }));
  }, [storeCards, storeBoards, storeCardMembers, storeSubBoards, queryNorm, filters, sprintFilter, viewerId]);

  const mineHiddenCount = useMemo(() => {
    const memberByCard = new Map<string, Set<string>>();
    for (const cm of storeCardMembers) {
      const s = memberByCard.get(cm.cardId) ?? new Set<string>();
      s.add(cm.userId);
      memberByCard.set(cm.cardId, s);
    }
    return countMineHiddenRoadmapCards(storeCards, {
      queryNorm,
      filters,
      sprintFilter,
      viewerId,
      memberByCard,
      now: new Date(),
      requireScheduled: viewMode === "gantt",
    });
  }, [storeCards, storeCardMembers, queryNorm, filters, sprintFilter, viewerId, viewMode]);

  // Same user-filter predicate the Gantt applies, but without the
  // "needs start+target date" gate — the list view shows undated rows
  // too. Returns null when no filter is active so the ListView can skip
  // the membership check entirely.
  const listFilteredCardIds = useMemo<Set<string> | null>(() => {
    const hasFilter =
      queryNorm !== "" ||
      filters.types.length > 0 ||
      sprintFilter !== "" ||
      filters.due === "overdue" ||
      filters.assignedToMe ||
      filters.unassigned;
    if (!hasFilter) return null;

    const memberByCard = new Map<string, Set<string>>();
    for (const cm of storeCardMembers) {
      const s = memberByCard.get(cm.cardId) ?? new Set<string>();
      s.add(cm.userId);
      memberByCard.set(cm.cardId, s);
    }
    const now = new Date();
    const passes = (c: typeof storeCards[number]) =>
      roadmapUserFilterPasses(c, {
        queryNorm,
        filters,
        sprintFilter,
        viewerId,
        memberByCard,
        now,
      });

    const cardById = new Map<string, typeof storeCards[number]>();
    for (const c of storeCards) cardById.set(c.id, c);
    const out = new Set<string>();
    for (const c of storeCards) {
      if (passes(c)) out.add(c.id);
    }
    // Pull ancestors so a matching subtask/task keeps its parent visible.
    for (const id of [...out]) {
      let cur = cardById.get(id);
      while (cur?.parentCardId) {
        const parent = cardById.get(cur.parentCardId);
        if (!parent || parent.archived) break;
        if (out.has(parent.id)) break;
        out.add(parent.id);
        cur = parent;
      }
    }
    return out;
  }, [storeCards, storeCardMembers, queryNorm, filters, sprintFilter, viewerId]);

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

  // Earliest task start across the workspace — used to clamp milestone
  // drag so a milestone can never be moved before the first task begins.
  const earliestCardStart = useMemo<Date | null>(() => {
    let min: number | null = null;
    for (const c of storeCards) {
      if (c.archived) continue;
      if (!c.startDate) continue;
      const t = (c.startDate instanceof Date ? c.startDate : new Date(c.startDate)).getTime();
      if (min === null || t < min) min = t;
    }
    return min === null ? null : new Date(min);
  }, [storeCards]);

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

  // Cross-workspace scroll sync: wire this band's scroller into the page-level
  // SharedAxisProvider when mounted on /timeline. No-op on /w/:ws/roadmap.
  useRegisterSharedScroller(scrollerRef);

  // --- Fit zoom: measure canvas container width for responsive effectivePpd ---
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Set initial size
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // scrollerRef is stable; no deps needed

  // Continuous-zoom override pushed up from the mini-map resize handles.
  // While the user is dragging an edge of the viewport bar, this holds
  // the live pixels-per-day so canvas + headers + overlays all scale in
  // real time. Cleared when the user changes the discrete zoom from the
  // header, or programmatically by mini-map on pointerup if it commits a
  // snap.
  const sharedDragPpd = useSharedDragPpd();
  const [localDragPpdOverride, setLocalDragPpdOverride] = useState<number | null>(null);
  // On the cross-workspace /timeline surface, the mini-map resize handle
  // writes through SharedAxis so every band scales together. On the
  // single-workspace roadmap, fall back to per-band local state.
  const dragPpdOverride = sharedDragPpd
    ? sharedDragPpd.value
    : localDragPpdOverride;
  const setDragPpdOverride = sharedDragPpd
    ? sharedDragPpd.set
    : setLocalDragPpdOverride;

  const sharedRangeStart = sharedAxis?.range.start ?? null;
  const sharedRangeEnd = sharedAxis?.range.end ?? null;

  // Resolve effective pixels-per-day.
  // For fixed zoom levels this is the static value from pixelsPerDay().
  // For "fit" we divide by a 180-day focus window so density stays
  // readable; the canvas (totalDays * effectivePpd) can grow past the
  // viewport when the shared range extends to cover distant cards, and
  // the user scrolls to them. dragPpdOverride wins over both — used by
  // the mini-map for continuous resize-to-zoom.
  const effectivePpd = useMemo(() => {
    if (dragPpdOverride !== null) return dragPpdOverride;
    if (zoom !== "fit") return pixelsPerDay(zoom);
    if (containerWidth === 0) return 8; // pre-mount fallback
    return Math.max(2, containerWidth / 180);
  }, [dragPpdOverride, zoom, containerWidth]);

  const now = useMemo(() => new Date(), []);
  // Fit zoom focuses on open work: closed cards must not stretch the range
  // (and therefore the scroll extent), so a completed task far in the future
  // gets ignored and can't be scrolled to. Other zooms use the full set.
  // Fall back to all cards when everything is closed so the view never blanks.
  const rangeCards = useMemo(() => {
    if (zoom !== "fit") return cards;
    const open = cards.filter((c) => c.completedAt == null);
    return open.length > 0 ? open : cards;
  }, [cards, zoom]);
  // Base origin = current period (week/month/quarter). If any card starts
  // before that, walk the origin back to cover it (snapped to the same
  // zoom period so grid ticks stay aligned). Mirrors the forward extension
  // we already do for late targets.
  const gridStart = useMemo(() => {
    if (sharedRangeStart) return sharedRangeStart;
    const base = gridStartFor(now, zoom);
    const minStart = rangeCards.reduce(
      (acc, c) => (c.startDate.getTime() < acc ? c.startDate.getTime() : acc),
      base.getTime(),
    );
    if (minStart >= base.getTime()) return base;
    return gridStartFor(new Date(minStart), zoom);
  }, [rangeCards, now, zoom, sharedRangeStart]);
  const gridEnd = useMemo(() => {
    if (sharedRangeEnd) return sharedRangeEnd;
    const baseEnd = gridEndFor(gridStart, zoom);
    // Extend to cover any card past 6 months.
    const maxTarget = rangeCards.reduce(
      (acc, c) => (c.targetDate.getTime() > acc ? c.targetDate.getTime() : acc),
      baseEnd.getTime(),
    );
    return new Date(maxTarget);
  }, [rangeCards, gridStart, zoom, sharedRangeEnd]);
  const totalDays = Math.max(1, dayDiff(gridStart, gridEnd));
  const width = totalDays * effectivePpd;
  // Intra-day offset for the today markers. Week zoom only — month/quarter/fit
  // day columns are too narrow for the shift to read as information.
  // <11h → start of column, 11-14h → middle, ≥14h → end of column.
  // currentHour ticks every minute so the line shifts across the 11/14
  // thresholds without a page reload (also recovers after a system clock change).
  // null on server + first client render — keeps today marker x identical
  // across hydration (offset = 0). Resolves to local hour after mount.
  const [currentHour, setCurrentHour] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setCurrentHour(new Date().getHours());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  const todayDayOffset = useMemo(() => {
    if (zoom !== "week" || currentHour === null) return 0;
    if (currentHour < 11) return 0;
    if (currentHour < 14) return effectivePpd / 2;
    return effectivePpd;
  }, [zoom, currentHour, effectivePpd]);
  // Workspace-effective holidays (presets + overrides) falling within
  // the current grid. Memoised so the linear scan only re-runs when the
  // viewport range or the input list changes.
  const holidays = useMemo(
    () => holidaysInRange(holidayDefs, gridStart, gridEnd),
    [holidayDefs, gridStart, gridEnd],
  );

  // Plan #16b-β — expanded parent state lifted into RoadmapView.
  // Default = every parent with subtasks is expanded; the user can collapse
  // individual rows via the chevron. Pre-fill happens once on first render
  // after lanes populate; manual toggles after that take precedence.
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

  const subBoardsForLanes: SubBoardRef[] = useMemo(
    () =>
      storeSubBoards.map((sb) => ({
        id: sb.id,
        title: sb.title,
        parentCardId: sb.parentCardId,
      })),
    [storeSubBoards],
  );

  const lanes = useMemo(() => {
    if (laneMode === "assignee") {
      return groupByAssignee(cards, storeCardMembers, storeProfiles);
    }
    if (laneMode === "component") {
      return groupByComponent(cards, storeCardComponents, storeComponents);
    }
    return groupBySubBoard(cards, subBoardsForLanes, storeBoards);
  }, [
    laneMode,
    cards,
    storeCardMembers,
    storeProfiles,
    storeCardComponents,
    storeComponents,
    subBoardsForLanes,
    storeBoards,
  ]);

  // Default-expand every parent with subtasks once lanes first populate.
  // Guarded by a ref so subsequent re-renders or user collapses don't
  // re-expand. Toggles after init take precedence.
  //
  // compactLanes (cross-workspace /timeline) skips auto-expand: each
  // expanded parent adds subtaskRowsByParent[id].length rows to lane
  // height. On a surface with shared range + many bands that multiplies
  // into hundreds of pixels of empty vertical space. User can still
  // expand any single parent manually.
  const didInitExpandedRef = useRef(false);
  useEffect(() => {
    if (didInitExpandedRef.current) return;
    if (lanes.length === 0) return;
    didInitExpandedRef.current = true;
    if (compactLanes) return;
    const next = new Set<string>();
    for (const lane of lanes) {
      for (const parentId of Object.keys(lane.subtaskRowsByParent)) {
        next.add(parentId);
      }
    }
    if (next.size > 0) setExpandedParents(next);
  }, [lanes, compactLanes]);

  // Per-lane stacking + total height. Each entry tracks where in the
  // canvas its body bars start, and pre-computes per-row offsets for any
  // expanded subtask groups so the bar renderer can place children
  // beneath the parent without re-doing layout work.
  const laneLayout = useMemo(() => {
    let yCursor = HEADER_STRIP_HEIGHT;
    return lanes.map((lane) => {
      // Default behaviour: one row per task in the lane (sorted by
      // startDate) so the hierarchy reads top-to-bottom under each anchor.
      // `compactLanes` (cross-workspace /timeline) falls back to greedy
      // packing — non-overlapping tasks share a row — so the lane height
      // doesn't reserve a row per off-screen card when the shared range
      // stretches the canvas across many months.
      const placed = compactLanes
        ? stackInLane(lane.cards)
        : lane.cards
            .slice()
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
            .map((card, idx) => ({ card, row: idx }));
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
      // Header card occupies its own row above body cards (see barCoords:
      // bodyTop = barRowsTop + ROW_HEIGHT when headerCard is set). Lane
      // height must therefore reserve 1 row for the header PLUS bodyRows
      // for stories. Without the header, fall back to at least 1 body
      // row so empty lanes still render.
      const totalBarRows = lane.headerCard
        ? 1 + bodyRows
        : Math.max(1, bodyRows);
      const height =
        LANE_HEADER_HEIGHT +
        (totalBarRows + extraRows) * ROW_HEIGHT +
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
  }, [lanes, expandedParents, compactLanes]);

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
        const x = xForDate(startOfDay(c.startDate), gridStart, effectivePpd);
        const w =
          xForDate(startOfDay(c.targetDate), gridStart, effectivePpd) - x + effectivePpd;
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
        const x = xForDate(startOfDay(c.startDate), gridStart, effectivePpd);
        const w =
          xForDate(startOfDay(c.targetDate), gridStart, effectivePpd) - x + effectivePpd;
        map.set(c.id, {
          x,
          y: bodyTop + p.row * ROW_HEIGHT + 4 + 14,
          w,
        });
      }
    }
    return map;
  }, [laneLayout, gridStart, effectivePpd]);

  const ticks = useMemo(
    () => buildHeaderTicks(gridStart, gridEnd, zoom, effectivePpd),
    [gridStart, gridEnd, zoom, effectivePpd],
  );

  // ---- Zoom toggle (URL-synced) ----
  function setViewMode(next: ViewMode) {
    setPreferences((current) =>
      patchWorkspacePreferences(current, workspaceId, {
        roadmap: { viewMode: next },
      }),
    );
    const params = new URLSearchParams(sp.toString());
    if (next === "gantt") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  function setZoom(next: Zoom) {
    // Anchor-preserving zoom: capture the geometry that maps the viewport
    // CENTER to a date NOW, while the old ppd/gridStart still apply. The
    // layout effect below re-derives scrollLeft once the new scale commits so
    // the same date stays centered instead of the viewport jumping elsewhere.
    const sc = scrollerRef.current;
    if (sc) {
      pendingScaleAnchorRef.current = {
        scrollLeft: sc.scrollLeft,
        viewportWidth: sc.clientWidth,
        gridStart,
        ppd: effectivePpd,
      };
    }
    // Picking a discrete zoom (header select, or programmatic) exits any
    // continuous-resize state from the mini-map so the new zoom's native
    // ppd takes effect immediately.
    setDragPpdOverride(null);
    setPreferences((current) =>
      patchWorkspacePreferences(current, workspaceId, { roadmap: { zoom: next } }),
    );
    const params = new URLSearchParams(sp.toString());
    params.set("zoom", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // ---- Lane mode toggle (URL-synced + workspace pref for cross-session restore) ----
  function setLaneMode(next: LaneMode) {
    if (useWsPrefs) {
      setPreferences((current) =>
        patchWorkspacePreferences(current, workspaceId, {
          roadmap: { laneMode: next },
        }),
      );
    }
    const params = new URLSearchParams(sp.toString());
    if (next === "sub_board") params.delete("lanes");
    else params.set("lanes", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Plan #16b-γ-G G4 — priority-gutter toggle (URL + workspace pref).
  // When turning off, write the explicit `?gutter=0` so the URL "wins"
  // over a stale truthy pref reading immediately after the toggle (we'd
  // otherwise read pref=true on the next render and bounce back on).
  function toggleGutter() {
    const next = !gutterOn;
    if (useWsPrefs) {
      setPreferences((current) =>
        patchWorkspacePreferences(current, workspaceId, {
          roadmap: { gutter: next },
        }),
      );
    }
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("gutter", "1");
    else params.delete("gutter");
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
  // Open the QuickCardView popup IN-PLACE rather than navigating to the
  // full card route. The popup's "Open advanced settings" button still
  // jumps to /b/[boardId]/c/[cardId] when the user wants the full editor.
  const onOpenCard = useCallback(
    (cardId: string, boardId: string) => {
      // Back-nav approach: remember the roadmap origin and explicitly restore
      // it when the in-place quick view closes. router.back() is unreliable
      // here because roadmap cards can also be opened via board-scoped card
      // routes whose close behavior falls back to /b/[boardId].
      rememberRoadmapCardOrigin(workspaceId, sp.toString() ? `?${sp.toString()}` : "");
      setQuickViewCard({ cardId, boardId });
    },
    [workspaceId, sp],
  );

  // Quick-view data — resolved against the workspace store. The selectors
  // run on every render but stay cheap because they short-circuit when
  // no card is open. Array selectors are wrapped in useShallow to dodge
  // the snapshot-loop bug we previously patched on the board surface.
  const quickViewCardId = quickViewCard?.cardId ?? null;
  const quickViewStoreCard = useWorkspaceStore((s) =>
    quickViewCardId ? (s.cards.find((c) => c.id === quickViewCardId) ?? null) : null,
  );
  const quickViewMemberIds = useWorkspaceStore(
    useShallow((s) =>
      quickViewCardId
        ? s.cardMembers
            .filter((m) => m.cardId === quickViewCardId)
            .map((m) => m.userId)
        : ([] as string[]),
    ),
  );
  // Return raw store array. useShallow caches by item-reference, so mapping
  // to fresh {id,displayName,avatarUrl} objects inside the selector breaks
  // the cache → snapshot loop. The transform now happens in useMemo below.
  const quickViewProfilesRaw = useWorkspaceStore(
    useShallow((s) => s.workspaceProfiles),
  );
  // Two primitive scalar selectors — same {total, done} object would
  // trip Zustand's snapshot-cache warning. Pattern mirrors
  // card-tile-subtask-badge.tsx.
  const quickViewSubtaskTotal = useWorkspaceStore((s) => {
    if (!quickViewCardId) return 0;
    let n = 0;
    for (const c of s.cards) {
      if (c.parentCardId === quickViewCardId && !c.archived) n += 1;
    }
    return n;
  });
  const quickViewSubtaskDone = useWorkspaceStore((s) => {
    if (!quickViewCardId) return 0;
    let n = 0;
    for (const c of s.cards) {
      if (
        c.parentCardId === quickViewCardId &&
        !c.archived &&
        c.completedAt != null
      ) {
        n += 1;
      }
    }
    return n;
  });
  // Child rows for the qv subtask list. The qv body has its own
  // BoardStoreContext-backed selector, but the roadmap mounts the dialog
  // without a board store — so we resolve the rows from the workspace
  // store and pass them in. useShallow keeps the snapshot stable across
  // unrelated card edits.
  const quickViewSubtaskRowsRaw = useWorkspaceStore(
    useShallow((s) => {
      if (!quickViewCardId) return s.cards.slice(0, 0);
      return s.cards.filter(
        (c) => c.parentCardId === quickViewCardId && !c.archived,
      );
    }),
  );
  const quickViewSubtaskRows = useMemo<QuickViewSubtask[]>(
    () =>
      quickViewSubtaskRowsRaw
        .map((c) => ({
          id: c.id,
          title: c.title,
          type: c.type,
          completedAt: c.completedAt,
          dueComplete: c.dueComplete,
          position: c.position,
          boardId: c.boardId,
        }))
        .sort((a, b) => ((a.position ?? "") < (b.position ?? "") ? -1 : 1)),
    [quickViewSubtaskRowsRaw],
  );
  // Google-Calendar-style detail swap: clicking a subtask re-opens the
  // qv against that subtask in place. We resolve the subtask's own
  // boardId here (it may differ from the parent's when the parent owns
  // a sub-board) and reuse onOpenCard so the back-nav origin tracking
  // matches the user's first qv entry.
  const onOpenSubtask = useCallback(
    (subtaskId: string) => {
      const row = quickViewSubtaskRows.find((r) => r.id === subtaskId);
      if (!row || !row.boardId) return;
      onOpenCard(subtaskId, row.boardId);
    },
    [quickViewSubtaskRows, onOpenCard],
  );
  const quickViewMemberProfiles = useMemo(
    () =>
      quickViewMemberIds
        .map((id) => quickViewProfilesRaw.find((p) => p.id === id))
        .filter((p): p is (typeof quickViewProfilesRaw)[number] => !!p)
        .map((p) => ({
          id: p.id,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
        })),
    [quickViewMemberIds, quickViewProfilesRaw],
  );
  // Mirror of the assigned-only list, but built from the full workspace
  // profile pool so users can add anyone in the workspace.
  const quickViewAvailableMembers = useMemo(
    () =>
      quickViewProfilesRaw.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
      })),
    [quickViewProfilesRaw],
  );

  // === Quick-view edit wiring ==========================================
  // Optimistic local mutation via the workspace store, then server action.
  // We keep the local store + server action as the source of truth; failure
  // path just toasts (CDC will eventually reconcile).
  const upsertCardMemberLocal = useWorkspaceStore((s) => s.upsertCardMember);
  const removeCardMemberLocal = useWorkspaceStore((s) => s.removeCardMember);
  const quickViewCardIdRef = quickViewCardId;
  const onQuickPatch = useCallback(
    async (patch: QuickViewPatchInput) => {
      if (!quickViewCardIdRef) return;
      const id = quickViewCardIdRef;
      const localPatch: Record<string, unknown> = {};
      if (patch.title !== undefined) localPatch.title = patch.title;
      if (patch.description !== undefined)
        localPatch.description = patch.description;
      if (patch.dueDate !== undefined) {
        localPatch.dueDate =
          patch.dueDate === null
            ? null
            : patch.dueDate instanceof Date
              ? patch.dueDate
              : new Date(patch.dueDate);
      }
      if (patch.dueComplete !== undefined)
        localPatch.dueComplete = patch.dueComplete;
      if (patch.type !== undefined) localPatch.type = patch.type;
      if (patch.priority !== undefined) localPatch.priority = patch.priority;
      if (patch.startDate !== undefined) {
        localPatch.startDate =
          patch.startDate === null
            ? null
            : patch.startDate instanceof Date
              ? patch.startDate
              : new Date(patch.startDate);
      }
      if (patch.targetDate !== undefined) {
        localPatch.targetDate =
          patch.targetDate === null
            ? null
            : patch.targetDate instanceof Date
              ? patch.targetDate
              : new Date(patch.targetDate);
      }
      if (patch.completed !== undefined) {
        localPatch.completedAt = patch.completed ? new Date() : null;
        localPatch.dueComplete = patch.completed;
      }
      patchCardInStore(
        id,
        localPatch as Parameters<typeof patchCardInStore>[1],
      );
      try {
        await updateCard({ id, ...patch });
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to save");
      }
    },
    [patchCardInStore, quickViewCardIdRef],
  );

  // Inline subtask creation from the roadmap quick-view. Mirrors
  // card-tile's `onQuickCreateSubtask` (components/board/card-tile.tsx):
  // create in the parent's list with parentCardId so the new row inherits
  // the parent's owner, then promote type='subtask'. CDC echo populates
  // the workspace store; no optimistic patch needed.
  const quickViewParentListId = quickViewStoreCard?.listId ?? null;
  const onQuickCreateSubtask = useCallback(
    async (title: string) => {
      if (!quickViewCardIdRef || !quickViewParentListId) return;
      try {
        const created = await createCard({
          listId: quickViewParentListId,
          title,
          parentCardId: quickViewCardIdRef,
        });
        await updateCard({ id: created.id, type: "subtask" });
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to create subtask");
      }
    },
    [quickViewCardIdRef, quickViewParentListId],
  );

  const onQuickToggleMember = useCallback(
    async (userId: string) => {
      if (!quickViewCardIdRef) return;
      const id = quickViewCardIdRef;
      const isAssigned = quickViewMemberIds.includes(userId);
      if (isAssigned) {
        removeCardMemberLocal(id, userId);
      } else {
        // cardMembers in the workspace snapshot is {cardId, userId} — no
        // boardId field on the runtime row (the trigger derives it).
        upsertCardMemberLocal({ cardId: id, userId });
      }
      try {
        await toggleCardMember({ cardId: id, userId });
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to update assignees");
      }
    },
    [
      quickViewCardIdRef,
      quickViewMemberIds,
      upsertCardMemberLocal,
      removeCardMemberLocal,
    ],
  );

  const drag = useRoadmapDragHarness({
    workspaceId,
    ppd: effectivePpd,
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
      const x = xForDate(startOfDay(target), gridStart, effectivePpd);
      const desired = x - scroller.clientWidth / 2;
      const max = scroller.scrollWidth - scroller.clientWidth;
      const left = Math.max(0, Math.min(max, desired));
      scroller.scrollTo({ left, behavior: "smooth" });
    },
    [gridStart, effectivePpd],
  );

  // Cross-workspace surface: page-level Today / date-picker calls into the
  // band's jumpToDate (first one registered wins), then scroll-sync mirrors
  // the result to every other band. No-op on /w/:ws/roadmap (no provider).
  useEffect(() => {
    if (!sharedAxis) return;
    return sharedAxis.registerJumpToDate(jumpToDate);
  }, [sharedAxis, jumpToDate]);


  // Initial viewport anchor. Zoom/view preferences are server-backed; the
  // horizontal scroll position is intentionally not persisted.
  const initialScrollAppliedRef = useRef(false);
  useEffect(() => {
    if (initialScrollAppliedRef.current) return;
    initialScrollAppliedRef.current = true;
    requestAnimationFrame(() => {
      const sc = scrollerRef.current;
      if (!sc) return;
      const x = xForDate(startOfDay(now), gridStart, effectivePpd);
      const desired = x - sc.clientWidth / 4;
      const max = sc.scrollWidth - sc.clientWidth;
      sc.scrollLeft = Math.max(0, Math.min(max, desired));
    });
  }, [gridStart, effectivePpd, now]);

  // Anchor-preserving discrete zoom. `setZoom` (header dropdown, mobile sheet,
  // and the +/- keyboard shortcuts) stashes the pre-change geometry here; once
  // the new effectivePpd/gridStart commit, re-center the same date so changing
  // the time scale zooms around the viewport center instead of jumping. Only
  // fires when a discrete zoom was requested (ref non-null) — container
  // resizes, the one-time initial anchor, jump-to-date, focus, and the
  // mini-map's continuous edge-drag re-anchor all leave the ref null, so this
  // effect is a no-op for them. Mirrors the mini-map's edge-drag re-anchor
  // pattern (a layout effect keyed on ppd/grid that re-pins scrollLeft).
  const pendingScaleAnchorRef = useRef<{
    scrollLeft: number;
    viewportWidth: number;
    gridStart: Date;
    ppd: number;
  } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingScaleAnchorRef.current;
    if (!pending) return;
    pendingScaleAnchorRef.current = null;
    const sc = scrollerRef.current;
    if (!sc) return;
    const max = Math.max(0, sc.scrollWidth - sc.clientWidth);
    sc.scrollLeft = preservedScrollLeft(
      pending.scrollLeft,
      pending.viewportWidth,
      pending.gridStart,
      pending.ppd,
      gridStart,
      effectivePpd,
      max,
    );
  }, [gridStart, effectivePpd]);

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
      className={fillHeight ? "flex flex-col flex-1 min-h-0" : "space-y-4"}
    >
      {!hideChrome && (
        <div
          className="sticky top-14 z-30 -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 pt-3 pb-3 bg-[color:var(--bg-deep)]/95 backdrop-blur-sm border-b border-hairline space-y-3"
          data-testid="roadmap-sticky-header"
        >
          <RoadmapHeader
            zoom={zoom}
            onSetZoom={setZoom}
            laneMode={laneMode}
            onSetLaneMode={setLaneMode}
            viewMode={viewMode}
            onSetViewMode={setViewMode}
            subscribed={subscribed}
            showCriticalPath={showCriticalPath}
            onToggleCriticalPath={() => setShowCriticalPath((p) => !p)}
            autoCascade={autoCascade}
            onToggleAutoCascade={toggleAutoCascade}
            gutter={gutterOn}
            onToggleGutter={toggleGutter}
            onJumpToDate={jumpToDate}
            onOpenNewCard={isGuest ? undefined : () => setNewCardOpen(true)}
            onChipDragStart={drag.onChipDragStart}
            queryDraft={queryDraft}
            onQueryDraftChange={setQueryDraft}
            searchInputRef={searchInputRef}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            gridStart={gridStart}
            gridEnd={gridEnd}
            baselineSlot={
              <BaselineMenu
                workspaceId={workspaceId}
                onCompare={(id) => setCompareBaselineId(id)}
              />
            }
          />
          {/* === MILESTONE MARKERS START (toolbar) === */}
          <div className="flex items-center gap-2 flex-wrap">
            <AssigneeFilterRow
              workspaceId={workspaceId}
              hiddenCount={mineHiddenCount}
            />
            <RoadmapFilterBar
              sprints={storeSprints}
              workspaceId={workspaceId}
            />
            <button
              type="button"
              onClick={() => setShowMilestones((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] ${
                !showMilestones
                  ? "border-fg/40 bg-fg/10 text-fg"
                  : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
              }`}
              data-testid="roadmap-toggle-milestones"
            >
              {showMilestones ? "Hide milestones" : "Show milestones"}
            </button>
            {!isGuest && (
              <button
                type="button"
                onClick={() => {
                  setEditingMilestone(null);
                  setMilestoneDialogOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]"
                data-testid="roadmap-add-milestone"
              >
                + Add milestone
              </button>
            )}
          </div>
          {/* === MILESTONE MARKERS END (toolbar) === */}
          {viewMode === "gantt" && cards.length > 0 && (
            <div className="hidden md:block">
              <RoadmapMiniMap
                cards={cards}
                gridStart={gridStart}
                gridEnd={gridEnd}
                canvasWidth={width}
                scrollerRef={scrollerRef}
                zoom={zoom}
                onSetZoom={setZoom}
                effectivePpd={effectivePpd}
                onPpdOverride={setDragPpdOverride}
              />
            </div>
          )}
        </div>
      )}

      {/* Task 6 — flat list alternative. Renders epic → task → subtask
          ordered by startDate ASC. Uses the same store data the gantt
          consumes; no extra queries. */}
      {viewMode === "list" ? (
        <RoadmapListView
          workspaceId={workspaceId}
          filteredCardIds={listFilteredCardIds}
        />
      ) : cards.length === 0 ? (
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
          {!compactLanes &&
            lanes.length === 1 &&
            lanes[0].kind === "uncategorized" &&
            lanes[0].cards.length <= 1 && (
              <div
                className="mx-auto max-w-2xl py-8 text-center text-fg-faint"
                data-testid="roadmap-empty-unassigned-banner"
              >
                Open a card and choose <span className="chip mono-meta-sm">Make sub-board</span> to organize work into lanes.
              </div>
            )}
        <div
          className={`flex border border-hairline rounded-xl overflow-hidden bg-[color:var(--bg-1)]${
            fillHeight ? " flex-1 min-h-0" : ""
          }`}
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
          {/* Cross-workspace surface only: workspace column sits to the LEFT
              of the lane panel so each row reads WORKSPACE · LANE · BARS.
              Vertical mono-meta keeps the column narrow (40px) so it earns
              real estate against the lane label panel without crowding the
              canvas. Background is --bg-2 (one step deeper than --surface)
              so the column reads as a separator, not a second lane panel. */}
          {workspaceColumn && (
            <div
              className="shrink-0 border-r border-hairline bg-[color:var(--bg-2)] relative flex"
              style={{ width: 40 }}
              data-testid="roadmap-workspace-column"
            >
              {onCollapse ? (
                <button
                  type="button"
                  onClick={onCollapse}
                  className="border-b border-hairline absolute inset-x-0 top-0 text-fg-faint hover:text-fg hover:bg-[color:var(--surface-strong)] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                  style={{ height: HEADER_STRIP_HEIGHT }}
                  aria-label={`Collapse ${workspaceColumn.name}`}
                  title={`Collapse ${workspaceColumn.name}`}
                  data-testid="roadmap-workspace-collapse"
                >
                  <ChevronUp className="size-4" aria-hidden />
                </button>
              ) : (
                <div
                  className="border-b border-hairline absolute inset-x-0 top-0 mono-meta-sm text-fg-faint flex items-end justify-center"
                  style={{ height: HEADER_STRIP_HEIGHT }}
                  aria-hidden
                >
                  WS
                </div>
              )}
              {workspaceColumn.href ? (
                <Link
                  href={workspaceColumn.href}
                  className="block w-full mono-meta-sm tracking-[0.14em] text-fg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                  style={{
                    writingMode: "vertical-rl",
                    paddingTop: HEADER_STRIP_HEIGHT + 12,
                    paddingLeft: 12,
                  }}
                  title={workspaceColumn.name}
                >
                  {workspaceColumn.name.toUpperCase()}
                </Link>
              ) : (
                <div
                  className="block w-full mono-meta-sm tracking-[0.14em] text-fg-muted"
                  style={{
                    writingMode: "vertical-rl",
                    paddingTop: HEADER_STRIP_HEIGHT + 12,
                    paddingLeft: 12,
                  }}
                  title={workspaceColumn.name}
                >
                  {workspaceColumn.name.toUpperCase()}
                </div>
              )}
            </div>
          )}
          {/* Lane labels (sticky) — width driven by `--lane-label-w` so the
              panel can collapse on narrow viewports (Task 9). */}
          <div
            ref={labelPanelRef}
            className="shrink-0 border-r border-hairline bg-[color:var(--surface)] relative"
            style={{
              width: "var(--lane-label-w)",
              "--lane-label-w": LANE_LABEL_WIDTH_CSS,
            } as React.CSSProperties}
          >
            <div
              className="border-b border-hairline mono-meta-sm text-fg-faint flex items-end px-3 pb-1"
              style={{ height: HEADER_STRIP_HEIGHT }}
            >
              LANE
            </div>
            {laneLayout.map((ll) => {
              const laneHeaderCard = ll.lane.headerCard;
              const draggable = laneMode === "sub_board" && laneHeaderCard !== null;
              const isDragging =
                drag.rowDragGhost !== null &&
                laneHeaderCard?.id === drag.rowDragGhost.cardId;
              const count = ll.placed.length;
              // Cards-per-lane label. Orphan self-lanes get the ORPHAN
              // wording so it's clear they're not grouped under a sub-board.
              const meta =
                ll.lane.kind === "uncategorized"
                  ? `${count} ${count === 1 ? "ORPHAN" : "ORPHANS"}`
                  : `${count} ${count === 1 ? "CARD" : "CARDS"}`;
              // Lane titles link to the board the lane represents:
              // sub_board → the sub-board itself (lane.id is its board id);
              // uncategorized → the parent board (lane.id is the board id
              // since orphans are merged per-board). Assignee/component
              // lanes have no board target and remain plain text.
              const boardHref =
                ll.lane.kind === "sub_board" || ll.lane.kind === "uncategorized"
                  ? `/b/${ll.lane.id}`
                  : null;
              return (
                <div
                  key={ll.lane.id}
                  className={`group relative border-b border-hairline pl-7 pr-3 flex flex-col justify-center ${
                    isDragging ? "opacity-40" : ""
                  }`}
                  style={{ height: ll.height, minHeight: 64 }}
                  data-testid="roadmap-lane-row"
                  data-card-id={laneHeaderCard?.id}
                >
                  {draggable && laneHeaderCard && (
                    <RoadmapRowHandle
                      cardId={laneHeaderCard.id}
                      onDragStart={drag.beginRowDrag}
                    />
                  )}
                  {boardHref ? (
                    <Link
                      href={boardHref}
                      className="mono-meta text-fg line-clamp-2 break-words underline decoration-transparent hover:decoration-fg-muted focus-visible:decoration-fg-muted underline-offset-2 outline-none transition-[text-decoration-color] duration-150"
                      data-testid={laneHeaderCard ? "lane-header-label" : undefined}
                      data-card-id={laneHeaderCard?.id}
                      title={ll.lane.title}
                      aria-label={`Open board ${ll.lane.title}`}
                      // Don't let the link's pointerdown start a drag on the
                      // row handle (handle stops its own propagation; this
                      // is the symmetric guard for plain clicks landing on
                      // the title itself).
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {ll.lane.title}
                    </Link>
                  ) : (
                    <span
                      className="mono-meta text-fg line-clamp-2 break-words"
                      data-testid={laneHeaderCard ? "lane-header-label" : undefined}
                      data-card-id={laneHeaderCard?.id}
                      title={ll.lane.title}
                    >
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
            data-pan-mode={
              panning ? "panning" : spacePan ? "ready" : undefined
            }
            style={{
              cursor: panning ? "grabbing" : spacePan ? "grab" : undefined,
            }}
            onPointerDownCapture={handleScrollerPointerDown}
            onPointerMove={handleScrollerPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <div
              ref={canvasRef}
              className="relative"
              style={
                fillHeight
                  ? { width, minHeight: totalHeight, height: "100%" }
                  : { width, height: totalHeight }
              }
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
                    className="absolute top-0 flex items-start pt-1 pl-1.5"
                    style={{
                      left: t.x,
                      width: zoom === "week" ? effectivePpd : 1,
                      height: 24,
                    }}
                  >
                    <span className="whitespace-nowrap">
                      {fmtHeader(t.date, zoom)}
                    </span>
                  </div>
                ))}
              </div>
              {/* Vertical grid lines — clamped to lane content height so
                  when the canvas stretches past `totalHeight` (fillHeight
                  on /timeline) the empty area below lanes stays free of
                  hairlines bleeding through. */}
              {ticks.map((t, i) => (
                <div
                  key={`vl-${i}`}
                  aria-hidden
                  className="absolute top-0 border-l border-hairline/40"
                  style={{ left: t.x, height: totalHeight }}
                />
              ))}
              {/* Today marker — vertical 1px line at today's x. Rendered
                  beneath bars (z-default) so a bar covering today still
                  shows the line through hairline transparency. Height
                  clamped to lane content for the same reason as the grid
                  lines above. */}
              {(() => {
                const todayX =
                  xForDate(startOfDay(now), gridStart, effectivePpd) +
                  todayDayOffset;
                if (todayX < 0 || todayX > width) return null;
                return (
                  <div
                    aria-hidden
                    data-testid="roadmap-today-marker"
                    className="absolute top-0 w-px bg-fg/30 pointer-events-none"
                    style={{ left: todayX, height: totalHeight }}
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
                    const x = xForDate(cur, gridStart, effectivePpd);
                    stripes.push(
                      <div
                        key={`we-${cur.toISOString()}`}
                        data-testid="roadmap-weekend"
                        aria-hidden
                        className="absolute pointer-events-none bg-fg/[0.03]"
                        style={{
                          left: x,
                          top: HEADER_STRIP_HEIGHT,
                          height: Math.max(0, totalHeight - HEADER_STRIP_HEIGHT),
                          width: 2 * effectivePpd,
                        }}
                      />,
                    );
                    cur = addDays(cur, 7);
                  }
                  return <>{stripes}</>;
                })()}
              {/* Holiday shading. Same grayscale treatment as weekends, a
                  hair stronger alpha so a holiday that falls on a Sunday
                  reads slightly darker than the surrounding weekend. Skipped
                  on quarter zoom alongside weekends. Native `title=` carries
                  the name so a tap-and-hold or hover surfaces it; the
                  Workspace Settings → Calendar tab is the source of truth
                  for editing. */}
              {zoom !== "quarter" &&
                holidays.map((h) => {
                  const x = xForDate(h.date, gridStart, effectivePpd);
                  return (
                    <div
                      key={`hol-${h.date.toISOString()}`}
                      data-testid="roadmap-holiday"
                      data-holiday-name={h.name}
                      aria-hidden
                      title={h.name}
                      className="absolute pointer-events-none bg-fg/[0.10]"
                      style={{
                        left: x,
                        top: HEADER_STRIP_HEIGHT,
                        height: Math.max(0, totalHeight - HEADER_STRIP_HEIGHT),
                        width: effectivePpd,
                      }}
                    />
                  );
                })}
              {/* Today vertical indicator line */}
              {(() => {
                const today = startOfDay(new Date());
                if (today < gridStart || today > gridEnd) return null;
                const todayX =
                  xForDate(today, gridStart, effectivePpd) + todayDayOffset;
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
                  within its snap window. Suppressed when Alt is held (the
                  release will skip snap). Sits between today-line and the
                  bar layer so labels read above weekend
                  stripes but below dragged bars. */}
              {drag.snapPreview &&
                (() => {
                  const x = xForDate(drag.snapPreview.date, gridStart, effectivePpd);
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
              {/* === MILESTONE MARKERS START === */}
              {showMilestones && storedMilestones.length > 0 && (
                <MilestoneMarkers
                  milestones={storedMilestones}
                  zoom={zoom}
                  ppd={effectivePpd}
                  gridStart={gridStart}
                  gridEnd={gridEnd}
                  headerHeight={HEADER_STRIP_HEIGHT}
                  bodyHeight={fillHeight ? totalHeight : undefined}
                  canAdmin={true}
                  minDate={earliestCardStart}
                  onEdit={(m) => {
                    setEditingMilestone(m);
                    setMilestoneDialogOpen(true);
                  }}
                  onDeleted={(id) =>
                    setStoredMilestones((prev) => prev.filter((m) => m.id !== id))
                  }
                  onChanged={(row) =>
                    setStoredMilestones((prev) => {
                      const idx = prev.findIndex((m) => m.id === row.id);
                      if (idx < 0) return prev;
                      const next = [...prev];
                      next[idx] = row;
                      return next;
                    })
                  }
                />
              )}
              {/* === MILESTONE MARKERS END === */}
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
                    // Precompute geometry so we know each bar's right edge
                    // and where the next bar to its right starts. Used to
                    // suppress the trailing assignee stack when there isn't
                    // enough gap.
                    const geoms = rowCards.map((p) => {
                      const sx = xForDate(
                        startOfDay(p.card.startDate),
                        gridStart,
                        effectivePpd,
                      );
                      const sw =
                        xForDate(
                          startOfDay(p.card.targetDate),
                          gridStart,
                          effectivePpd,
                        ) -
                        sx +
                        effectivePpd;
                      return { p, sx, sw };
                    });
                    const sortedGeoms = [...geoms].sort((a, b) => a.sx - b.sx);
                    const nextLeftById = new Map<string, number>();
                    for (let i = 0; i < sortedGeoms.length; i += 1) {
                      const nextLeft =
                        i + 1 < sortedGeoms.length
                          ? sortedGeoms[i + 1].sx
                          : width;
                      nextLeftById.set(sortedGeoms[i].p.card.id, nextLeft);
                    }
                    renderedBars.push(
                      <div
                        key={`subrow-${parentCard.id}-${rowIdx}`}
                        className="absolute pointer-events-none"
                        style={{
                          left: 0,
                          right: 0,
                          top: barRowsTop + (rowCursor + rowIdx) * ROW_HEIGHT,
                          height: ROW_HEIGHT,
                        }}
                      >
                        {geoms.map(({ p, sx, sw }) => {
                          const sc = p.card;
                          const nextLeft = nextLeftById.get(sc.id) ?? width;
                          return (
                            <RoadmapBar
                              key={sc.id}
                              card={sc}
                              x={sx}
                              width={sw}
                              row={0}
                              isHeader={false}
                              focused={flashFocus === sc.id}
                              status={cardStatusById.get(sc.id) ?? null}
                              storyPoints={cardSpById.get(sc.id) ?? null}
                              sprintName={cardSprintNameById.get(sc.id) ?? null}
                              assignees={cardAssigneesById.get(sc.id) ?? []}
                              availableSpaceRight={nextLeft - (sx + sw)}
                              onMoveStart={handleMoveStart}
                              onResizeLeftStart={handleResizeLeftStart}
                              onResizeRightStart={handleResizeRightStart}
                              onOpen={onOpenCard}
                            />
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
                  nextLeft: number = width,
                ) => {
                  const c = parentCard;
                  const x = xForDate(startOfDay(c.startDate), gridStart, effectivePpd);
                  const w =
                    xForDate(startOfDay(c.targetDate), gridStart, effectivePpd) -
                    x +
                    effectivePpd;
                  const expanded = expandedParents.has(c.id);
                  const subRows =
                    ll.lane.subtaskRowsByParent[c.id] ?? [];
                  const hasChildren = subRows.length > 0;
                  const undated = undatedSubtaskCountByParent.get(c.id) ?? 0;
                  return (
                    <div
                      key={`bar-${c.id}`}
                      className="absolute pointer-events-none"
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
                          className="absolute top-1.5 size-5 rounded-md border border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg flex items-center justify-center pointer-events-auto"
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
                        assignees={cardAssigneesById.get(c.id) ?? []}
                        availableSpaceRight={nextLeft - (x + w)}
                        onMoveStart={handleMoveStart}
                        onResizeLeftStart={handleResizeLeftStart}
                        onResizeRightStart={handleResizeRightStart}
                        onOpen={onOpenCard}
                      />
                      {undated > 0 && (
                        <span
                          className="absolute top-2 chip mono-meta-sm pointer-events-auto"
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
                      className="absolute pointer-events-none"
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
                  // Sort by left edge so we can index each bar's nearest
                  // right neighbour for assignee-stack collision checks.
                  const sortedRowCards = [...rowCards]
                    .map((c) => ({
                      c,
                      lx: xForDate(
                        startOfDay(c.startDate),
                        gridStart,
                        effectivePpd,
                      ),
                    }))
                    .sort((a, b) => a.lx - b.lx);
                  const nextLeftByCardId = new Map<string, number>();
                  for (let i = 0; i < sortedRowCards.length; i += 1) {
                    const nl =
                      i + 1 < sortedRowCards.length
                        ? sortedRowCards[i + 1].lx
                        : width;
                    nextLeftByCardId.set(sortedRowCards[i].c.id, nl);
                  }
                  renderedBars.push(
                    <div
                      key={`stackrow-${ll.lane.id}-${r}`}
                      className="absolute pointer-events-none"
                      style={{
                        left: 0,
                        right: 0,
                        top: stackRowTop,
                        height: ROW_HEIGHT,
                      }}
                    >
                      {rowCards.map((c) =>
                        renderParentBar(
                          c,
                          false,
                          nextLeftByCardId.get(c.id) ?? width,
                        ),
                      )}
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
      {/* === MILESTONE MARKERS START (dialog) === */}
      <MilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={(v) => {
          setMilestoneDialogOpen(v);
          if (!v) setEditingMilestone(null);
        }}
        workspaceId={workspaceId}
        milestone={editingMilestone}
        onSaved={(row) => {
          setStoredMilestones((prev) => {
            const idx = prev.findIndex((m) => m.id === row.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = row;
              return next;
            }
            return [...prev, row];
          });
        }}
      />
      {/* === MILESTONE MARKERS END (dialog) === */}
      {/* Roadmap quick-view popup. Opened in-place by RoadmapBar clicks
          (onOpenCard); avoids cross-layout navigation that would
          otherwise bypass the parallel-route modal intercept. */}
      <CardQuickView
        card={
          quickViewStoreCard
            ? {
                id: quickViewStoreCard.id,
                title: quickViewStoreCard.title,
                description: quickViewStoreCard.description,
                dueDate: quickViewStoreCard.dueDate,
                dueComplete: quickViewStoreCard.dueComplete,
                completedAt: quickViewStoreCard.completedAt,
                type: quickViewStoreCard.type,
                priority: quickViewStoreCard.priority,
                startDate: quickViewStoreCard.startDate,
                targetDate: quickViewStoreCard.targetDate,
              }
            : null
        }
        memberProfiles={quickViewMemberProfiles}
        availableMembers={quickViewAvailableMembers}
        subtaskTotal={quickViewSubtaskTotal}
        subtaskDone={quickViewSubtaskDone}
        subtaskRows={quickViewSubtaskRows}
        onOpenSubtask={onOpenSubtask}
        boardId={quickViewCard?.boardId ?? ""}
        open={quickViewCard != null}
        onOpenChange={(next) => {
          if (!next) {
            setQuickViewCard(null);
            restoreRoadmapCardOrigin(
              router,
              roadmapHref(workspaceId, sp.toString() ? `?${sp.toString()}` : ""),
            );
          }
        }}
        onPatch={onQuickPatch}
        onToggleMember={onQuickToggleMember}
        onCreateSubtask={onQuickCreateSubtask}
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
          <dd className="text-fg">
            Cancel drag · clear search · close menus
          </dd>
          <dt className="mono-meta text-fg-faint">+ / −</dt>
          <dd className="text-fg">Zoom in / out</dd>
          <dt className="mono-meta text-fg-faint">← / →</dt>
          <dd className="text-fg">Scroll the timeline</dd>
          <dt className="mono-meta text-fg-faint">Shift + ← / →</dt>
          <dd className="text-fg">Page the timeline by one viewport</dd>
          <dt className="mono-meta text-fg-faint">Hold Space + drag</dt>
          <dd className="text-fg">Pan the timeline with the mouse</dd>
          <dt className="mono-meta text-fg-faint">n</dt>
          <dd className="text-fg">New card</dd>
          <dt className="mono-meta text-fg-faint">Right-click bar</dt>
          <dd className="text-fg">Open card context menu</dd>
          <dt className="mono-meta text-fg-faint">?</dt>
          <dd className="text-fg">Show this list</dd>
        </dl>
        <section
          className="mt-5 space-y-1.5"
          data-testid="roadmap-bar-legend"
        >
          <h3 className="mono-meta-sm text-fg-faint tracking-[0.14em]">
            BAR PATTERNS
          </h3>
          <dl className="rounded-md border border-hairline bg-[color:var(--surface)] divide-y divide-hairline overflow-hidden">
            {[
              {
                label: "TODO",
                desc: "Untriaged. Solid fill.",
                pattern: {
                  background:
                    "color-mix(in oklab, var(--status-todo) 22%, transparent)",
                },
              },
              {
                label: "IN PROGRESS",
                desc: "Pulses. Reduced-motion safe.",
                pattern: {
                  background:
                    "color-mix(in oklab, var(--status-in-progress) 38%, transparent)",
                  boxShadow:
                    "inset 0 0 0 1px color-mix(in oklab, var(--status-in-progress) 55%, transparent)",
                },
              },
              {
                label: "REVIEW",
                desc: "Diagonal stripes. Waiting on a human.",
                pattern: {
                  background:
                    "color-mix(in oklab, var(--status-review) 22%, transparent)",
                  backgroundImage:
                    "repeating-linear-gradient(45deg, color-mix(in oklab, var(--status-review) 45%, transparent) 0 4px, transparent 4px 8px)",
                },
              },
              {
                label: "DONE",
                desc: "Horizontal hatches. Closed and frozen.",
                pattern: {
                  background:
                    "color-mix(in oklab, var(--status-done) 22%, transparent)",
                  backgroundImage:
                    "repeating-linear-gradient(0deg, color-mix(in oklab, var(--status-done) 50%, transparent) 0 2px, transparent 2px 6px)",
                },
              },
              {
                label: "BLOCKED",
                desc: "Inset ring. Fenced off, needs a decision.",
                pattern: {
                  background:
                    "color-mix(in oklab, var(--status-blocked) 12%, transparent)",
                  boxShadow:
                    "inset 0 0 0 2px color-mix(in oklab, var(--status-blocked) 60%, transparent)",
                },
              },
            ].map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[3rem_6rem_1fr] gap-3 px-3 py-2 items-center"
              >
                <span
                  aria-hidden
                  className="h-5 w-full rounded-md border border-hairline-hi"
                  style={row.pattern as React.CSSProperties}
                />
                <dt className="mono-meta-sm tabular-nums text-fg">
                  {row.label}
                </dt>
                <dd className="text-sm text-fg-muted">{row.desc}</dd>
              </div>
            ))}
          </dl>
        </section>
      </DialogContent>
    </Dialog>
  );
}
