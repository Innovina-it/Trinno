"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useShallow } from "zustand/shallow";
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
import { NewCardDialog as RoadmapNewCardDialog } from "@/components/board/new-card-dialog";
import { RoadmapFilterBar } from "./roadmap-filter-bar";
import { AssigneeFilterRow } from "@/components/filters/assignee-filter-row";
import { RoadmapMiniMap } from "./mini-map";
import { RoadmapRowHandle } from "./roadmap-row-handle";
import { MilestoneMarkers } from "./milestone-markers";
import type { MilestoneRow } from "./milestone-dialog";
import { MilestoneDialog } from "./milestone-dialog";
import { listMilestones } from "@/actions/milestones";
import { updateCard } from "@/actions/cards";
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
import {
  CardQuickView,
  type PatchInput as QuickViewPatchInput,
} from "@/components/board/card-quick-view";
import { parseFilters } from "@/lib/board-filters";
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
}: {
  workspaceId: string;
  /** Used for assignee/unassigned filter. Pass null/undefined for anonymous. */
  viewerId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const zoomParam = sp.get("zoom");
  const zoom: Zoom = (ZOOMS as string[]).includes(zoomParam ?? "")
    ? (zoomParam as Zoom)
    : "fit";
  const lanesParam = sp.get("lanes");
  const laneMode: LaneMode = (LANE_MODES as string[]).includes(lanesParam ?? "")
    ? (lanesParam as LaneMode)
    : "epic";
  const viewParam = sp.get("view");
  const viewMode: ViewMode = (VIEW_MODES as string[]).includes(viewParam ?? "")
    ? (viewParam as ViewMode)
    : "gantt";
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

  // === MILESTONE MARKERS START ===
  const [storedMilestones, setStoredMilestones] = useState<MilestoneRow[]>([]);
  const [showMilestones, setShowMilestones] = useState(true);
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
  const patchCardInStore = useWorkspaceStore((s) => s.patchCard);
  const setWorkspaceSnapshot = useWorkspaceStore((s) => s.setSnapshot);
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
    (async () => {
      const { data } = await supa.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supa.realtime.setAuth(token);
      if (cancelled) return;
      channel = supa
        .channel(`roadmap_boards:${workspaceId}`)
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
  }, [storeCards, storeBoards, storeCardMembers, queryNorm, filters, sprintFilter, viewerId]);

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

  // Resolve effective pixels-per-day.
  // For fixed zoom levels this is the static value from pixelsPerDay().
  // For "fit" we compute it so 180 days fill the available canvas width.
  const effectivePpd = useMemo(() => {
    if (zoom !== "fit") return pixelsPerDay(zoom);
    if (containerWidth === 0) return 8; // pre-mount fallback
    // scrollerRef is `flex-1` after the lane-label panel, so its clientWidth
    // already excludes the label panel. Divide directly by 180 days; no
    // further subtraction needed (previous code double-subtracted, leaving
    // ~200px empty on the right).
    return Math.max(2, containerWidth / 180);
  }, [zoom, containerWidth]);

  const now = useMemo(() => new Date(), []);
  // Base origin = current period (week/month/quarter). If any card starts
  // before that, walk the origin back to cover it (snapped to the same
  // zoom period so grid ticks stay aligned). Mirrors the forward extension
  // we already do for late targets.
  const gridStart = useMemo(() => {
    const base = gridStartFor(now, zoom);
    const minStart = cards.reduce(
      (acc, c) => (c.startDate.getTime() < acc ? c.startDate.getTime() : acc),
      base.getTime(),
    );
    if (minStart >= base.getTime()) return base;
    return gridStartFor(new Date(minStart), zoom);
  }, [cards, now, zoom]);
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
  const width = totalDays * effectivePpd;

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
    const params = new URLSearchParams(sp.toString());
    if (next === "gantt") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
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
  const quickViewMemberProfiles = useMemo(
    () =>
      quickViewMemberIds
        .map((id) => quickViewProfilesRaw.find((p) => p.id === id))
        .filter((p): p is (typeof quickViewProfilesRaw)[number] => !!p)
        .map((p) => ({
          id: p.id,
          displayName: p.displayName,
          // workspaceProfiles carries only {id, displayName}; surface a null
          // avatar so QuickViewProfile's shape is satisfied.
          avatarUrl: null as string | null,
        })),
    [quickViewMemberIds, quickViewProfilesRaw],
  );
  // Mirror of the assigned-only list, but built from the full workspace
  // profile pool so users can add anyone in the workspace. `avatarUrl`
  // is null because workspaceProfiles doesn't carry one.
  const quickViewAvailableMembers = useMemo(
    () =>
      quickViewProfilesRaw.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: null as string | null,
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
    // Apply saved zoom only if URL is silent on the matter.
    if (saved?.zoom && !zoomParam && (ZOOMS as string[]).includes(saved.zoom)) {
      const params = new URLSearchParams(sp.toString());
      params.set("zoom", saved.zoom);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    // Apply scrollX after first paint. If nothing saved, anchor on `now` so
    // the user lands on "today" even when the grid extends backward to
    // cover past-dated cards.
    if (typeof saved?.scrollX === "number") {
      requestAnimationFrame(() => {
        if (scrollerRef.current) {
          scrollerRef.current.scrollLeft = saved!.scrollX!;
        }
      });
    } else {
      requestAnimationFrame(() => {
        const sc = scrollerRef.current;
        if (!sc) return;
        const x = xForDate(startOfDay(now), gridStart, effectivePpd);
        const desired = x - sc.clientWidth / 4;
        const max = sc.scrollWidth - sc.clientWidth;
        sc.scrollLeft = Math.max(0, Math.min(max, desired));
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
        onOpenNewCard={() => setNewCardOpen(true)}
        onChipDragStart={drag.onChipDragStart}
        queryDraft={queryDraft}
        onQueryDraftChange={setQueryDraft}
        searchInputRef={searchInputRef}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        gridStart={gridStart}
        gridEnd={gridEnd}
      />
      {/* === MILESTONE MARKERS START (toolbar) === */}
      <div className="flex items-center gap-2 flex-wrap">
        <AssigneeFilterRow />
        <RoadmapFilterBar mineHiddenCount={mineHiddenCount} />
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
          />
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
              const epicHeader = ll.lane.headerCard;
              const draggable = laneMode === "epic" && epicHeader !== null;
              const isDragging =
                drag.rowDragGhost !== null &&
                epicHeader?.id === drag.rowDragGhost.cardId;
              const count = ll.placed.length;
              // Story was retired as a picker type (commit 131081f); epic
              // children now span task/bug/subtask, so "STORY/STORIES" is
              // wrong. Use the same neutral CARD/CARDS as the other lanes.
              const meta =
                ll.lane.kind === "uncategorized"
                  ? `${count} ${count === 1 ? "ORPHAN" : "ORPHANS"}`
                  : `${count} ${count === 1 ? "CARD" : "CARDS"}`;
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
                    <span
                      // Lane names used to link to retired /e/[id] routes,
                      // which now 404. Keep them non-clickable; lane filtering
                      // is controlled by the toolbar's lane-mode controls.
                      className="mono-meta text-fg line-clamp-2 break-words"
                      data-testid="lane-epic-header-label"
                      data-card-id={epicHeader.id}
                      title={ll.lane.title}
                    >
                      {ll.lane.title}
                    </span>
                  ) : (
                    <span
                      className="mono-meta text-fg line-clamp-2 break-words"
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
                const todayX = xForDate(startOfDay(now), gridStart, effectivePpd);
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
                          bottom: 0,
                          width: 2 * effectivePpd,
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
                const todayX = xForDate(today, gridStart, effectivePpd);
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
                  gridStart={gridStart}
                  gridEnd={gridEnd}
                  canvasHeight={totalHeight + HEADER_STRIP_HEIGHT}
                  headerHeight={HEADER_STRIP_HEIGHT}
                  canAdmin={true}
                  onEdit={(m) => {
                    setEditingMilestone(m);
                    setMilestoneDialogOpen(true);
                  }}
                  onDeleted={(id) =>
                    setStoredMilestones((prev) => prev.filter((m) => m.id !== id))
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
                            effectivePpd,
                          );
                          const sw =
                            xForDate(
                              startOfDay(sc.targetDate),
                              gridStart,
                              effectivePpd,
                            ) -
                            sx +
                            effectivePpd;
                          return (
                            <div
                              key={sc.id}
                              className="absolute h-4 rounded-full border border-dashed border-fg/40 bg-[color:var(--surface)]/70 hover:border-fg/80 hover:bg-[color:var(--surface-strong)] transition-colors flex items-center pl-3 pr-2 cursor-pointer select-none"
                              style={{
                                left: sx + 24,
                                width: Math.max(sw - 24, 12),
                                top: 10,
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
                              <span
                                aria-hidden
                                className="absolute -left-3 top-1/2 h-px w-3 bg-fg/30"
                              />
                              <span
                                aria-hidden
                                className="absolute left-1.5 top-1/2 -translate-y-1/2 size-1 rounded-full bg-fg/50"
                              />
                              <span className="text-[10px] text-fg-muted truncate tracking-tight">
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
