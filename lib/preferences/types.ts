import { type AssigneeMode, type Filters } from "@/lib/board-filters";
import { type Zoom } from "@/lib/roadmap/dates";

export type WorkspacePreferenceTab = "board" | "roadmap";
export type RoadmapViewModePreference = "gantt" | "list";

export type RoadmapPagePreferences = {
  zoom?: Zoom;
  viewMode?: RoadmapViewModePreference;
};

export type BacklogPagePreferences = Record<string, never>;

export type WorkspacePreferences = {
  activeTab?: WorkspacePreferenceTab;
  roadmap?: RoadmapPagePreferences;
  backlog?: BacklogPagePreferences;

  /** @deprecated use roadmap.zoom */
  roadmapZoom?: Zoom;
  /** @deprecated use roadmap.viewMode */
  roadmapViewMode?: RoadmapViewModePreference;
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

  workspaces?: Record<string, WorkspacePreferences>;
  boards?: Record<string, BoardPreferences>;

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
