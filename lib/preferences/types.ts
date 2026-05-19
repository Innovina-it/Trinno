import { type AssigneeMode, type Filters } from "@/lib/board-filters";
import { type Zoom } from "@/lib/roadmap/dates";

export type WorkspacePreferenceTab = "board" | "roadmap";
export type RoadmapViewModePreference = "gantt" | "list";

export type WorkspacePreferences = {
  activeTab?: WorkspacePreferenceTab;
  roadmapZoom?: Zoom;
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

  workspaces?: Record<string, WorkspacePreferences>;
  boards?: Record<string, BoardPreferences>;

  // Legacy flat keys. Keep readable for existing persisted rows while new
  // workspace/board scoped preferences roll out.
  activeTab?: "board" | "roadmap" | "timeline" | "workload";
  layoutDensity?: "compact" | "comfortable" | "spacious";
  boardSort?: "created" | "updated" | "manual";
  roadmapZoom?: Zoom;
  filters?: Record<string, unknown>;
};
