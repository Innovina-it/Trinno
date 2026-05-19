import { type Filters } from "@/lib/board-filters";
import { type Zoom } from "@/lib/roadmap/dates";
import {
  type BoardPreferences,
  type Preferences,
  type RoadmapViewModePreference,
  type WorkspacePreferences,
  type WorkspacePreferenceTab,
} from "@/lib/preferences/types";

const WORKSPACE_TABS = ["board", "roadmap"] as const;
const ROADMAP_VIEW_MODES = ["gantt", "list"] as const;
const ROADMAP_ZOOMS = ["fit", "week", "month", "quarter"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isWorkspaceTab(value: unknown): value is WorkspacePreferenceTab {
  return (WORKSPACE_TABS as readonly unknown[]).includes(value);
}

function isRoadmapZoom(value: unknown): value is Zoom {
  return (ROADMAP_ZOOMS as readonly unknown[]).includes(value);
}

function isRoadmapViewMode(
  value: unknown,
): value is RoadmapViewModePreference {
  return (ROADMAP_VIEW_MODES as readonly unknown[]).includes(value);
}

function isFilters(value: unknown): value is Filters {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.types) &&
    Array.isArray(value.labelIds) &&
    (value.due === "overdue" || value.due === "this-week" || value.due === null) &&
    typeof value.assignedToMe === "boolean" &&
    typeof value.unassigned === "boolean" &&
    typeof value.scheduled === "boolean" &&
    typeof value.hideCompleted === "boolean"
  );
}

export function getWorkspacePreferences(
  preferences: Preferences,
  workspaceId: string,
): WorkspacePreferences {
  const legacy: WorkspacePreferences = {};
  if (isWorkspaceTab(preferences.activeTab)) {
    legacy.activeTab = preferences.activeTab;
  }
  if (isRoadmapZoom(preferences.roadmapZoom)) {
    legacy.roadmapZoom = preferences.roadmapZoom;
  }

  const scoped = preferences.workspaces?.[workspaceId] ?? {};
  return {
    ...legacy,
    ...scoped,
    activeTab: isWorkspaceTab(scoped.activeTab)
      ? scoped.activeTab
      : legacy.activeTab,
    roadmapZoom: isRoadmapZoom(scoped.roadmapZoom)
      ? scoped.roadmapZoom
      : legacy.roadmapZoom,
    roadmapViewMode: isRoadmapViewMode(scoped.roadmapViewMode)
      ? scoped.roadmapViewMode
      : undefined,
  };
}

export function getBoardPreferences(
  preferences: Preferences,
  boardId: string,
): BoardPreferences {
  const legacyFilters = preferences.filters?.[boardId];
  const scoped = preferences.boards?.[boardId] ?? {};
  return {
    ...scoped,
    filters: isFilters(scoped.filters)
      ? scoped.filters
      : isFilters(legacyFilters)
        ? legacyFilters
        : undefined,
  };
}

export function patchWorkspacePreferences(
  preferences: Preferences,
  workspaceId: string,
  patch: WorkspacePreferences,
): Partial<Preferences> {
  return {
    workspaces: {
      ...(preferences.workspaces ?? {}),
      [workspaceId]: {
        ...(preferences.workspaces?.[workspaceId] ?? {}),
        ...patch,
      },
    },
  };
}

export function patchBoardPreferences(
  preferences: Preferences,
  boardId: string,
  patch: BoardPreferences,
): Partial<Preferences> {
  return {
    boards: {
      ...(preferences.boards ?? {}),
      [boardId]: {
        ...(preferences.boards?.[boardId] ?? {}),
        ...patch,
        dataVisibilityFilters: {
          ...(preferences.boards?.[boardId]?.dataVisibilityFilters ?? {}),
          ...(patch.dataVisibilityFilters ?? {}),
        },
      },
    },
  };
}
