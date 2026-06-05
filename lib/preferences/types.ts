import { type AssigneeMode, type Filters } from "@/lib/board-filters";
import { type Zoom } from "@/lib/roadmap/dates";

export type WorkspacePreferenceTab = "board" | "roadmap";
export type RoadmapViewModePreference =
  | "gantt"
  | "list"
  | "deliverable"
  | "milestone";

export type RoadmapLaneModePreference = "sub_board" | "assignee" | "component";

export type RoadmapPagePreferences = {
  zoom?: Zoom;
  viewMode?: RoadmapViewModePreference;
  /** Persisted roadmap filter bag (types, due, assignee, etc.). Mirrors the
   *  board's `BoardPreferences.filters` so the user finds the same filter
   *  applied after a reload / cross-device sign-in. URL stays the source of
   *  truth during a session; this is the seed for the next session. */
  filters?: Filters;
  /** Currently-selected sprint chip on the roadmap. URL key `?sprint=`. */
  sprintFilter?: string;
  /** "Group lanes" dropdown selection (sub_board / assignee / component). */
  laneMode?: RoadmapLaneModePreference;
  /** View options dropdown — Critical path overlay. */
  showCriticalPath?: boolean;
  /** View options dropdown — Auto-reschedule cascade on drag. */
  autoCascade?: boolean;
  /** View options dropdown — Priority gutter column. */
  gutter?: boolean;
  /** Milestone markers toolbar toggle. Default true (markers visible). */
  showMilestones?: boolean;
};

export type BacklogPagePreferences = Record<string, never>;

export type WorkspacePreferences = {
  activeTab?: WorkspacePreferenceTab;
  roadmap?: RoadmapPagePreferences;
  backlog?: BacklogPagePreferences;
  /** UUID of the board the user last opened in this workspace. Used by
   *  `/w/{wsId}` to redirect into the board the user left instead of
   *  the board picker when the workspace's active tab is "board".
   *  Validated server-side against the workspace's current board list —
   *  a stale id (deleted board, board moved to another workspace,
   *  membership revoked) falls back to `/w/{wsId}/boards`. */
  lastBoardId?: string;

  /** @deprecated use roadmap.zoom */
  roadmapZoom?: Zoom;
  /** @deprecated use roadmap.viewMode */
  roadmapViewMode?: RoadmapViewModePreference;
};

/** Cross-workspace `/timeline` surface. Scope is global (not per-workspace)
 *  because the page itself aggregates every workspace into one view. */
export type TimelinePreferences = {
  filters?: Filters;
  /** "Group lanes" dropdown selection. */
  laneMode?: "sub_board" | "assignee" | "component";
  /** Priority gutter toggle from the View options dropdown. */
  gutter?: boolean;
  /** Workspaces whose bands are currently collapsed in the band stack. */
  collapsedWorkspaceIds?: string[];
};

export type BoardPreferences = {
  filters?: Filters;
  dataVisibilityFilters?: {
    assignee?: AssigneeMode;
  };
  sprintStripVisible?: boolean;
};

export type Preferences = {
  sidebarCollapsed?: boolean;
  layoutDensity?: "compact" | "comfortable" | "spacious";

  /** UUID of the workspace the user last visited. Used by the home page
   *  (`/`) to redirect into the right workspace on next sign-in instead
   *  of always landing on the first workspace in the user's roster.
   *  Validated server-side against the current membership list — a stale
   *  id (removed workspace, revoked membership) falls back to the first
   *  workspace. */
  lastWorkspaceId?: string;

  workspaces?: Record<string, WorkspacePreferences>;
  boards?: Record<string, BoardPreferences>;
  /** Filters applied on the cross-workspace `/timeline` page. Global scope. */
  timeline?: TimelinePreferences;

  // Legacy flat keys. Keep readable for existing persisted rows while new
  // workspace/board scoped preferences roll out. Will be removed in a future
  // cleanup unit.
  /** @deprecated use workspaces[wsId].activeTab */
  activeTab?: "board" | "roadmap" | "timeline" | "workload";
  /** @deprecated use workspaces[wsId].roadmap.zoom */
  roadmapZoom?: Zoom;
  /** @deprecated use boards[boardId].filters */
  filters?: Record<string, unknown>;
};
