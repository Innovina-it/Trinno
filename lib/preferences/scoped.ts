import { type Filters } from "@/lib/board-filters";
import { type Zoom } from "@/lib/roadmap/dates";
import {
  type BacklogPagePreferences,
  type BoardPreferences,
  type Preferences,
  type RoadmapPagePreferences,
  type RoadmapViewModePreference,
  type TimelinePreferences,
  type WorkspacePreferences,
  type WorkspacePreferenceTab,
} from "@/lib/preferences/types";

const WORKSPACE_TABS = ["board", "roadmap"] as const;
const ROADMAP_VIEW_MODES = ["gantt", "list"] as const;
const ROADMAP_ZOOMS = ["fit", "week", "month", "quarter"] as const;
const ROADMAP_LANE_MODES = ["sub_board", "assignee", "component"] as const;

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
  const scoped = preferences.workspaces?.[workspaceId] ?? {};
  const nestedRoadmap = isRecord(scoped.roadmap) ? scoped.roadmap : undefined;

  // activeTab precedence: scoped workspace value, then legacy top-level.
  const activeTab = isWorkspaceTab(scoped.activeTab)
    ? scoped.activeTab
    : isWorkspaceTab(preferences.activeTab)
      ? preferences.activeTab
      : undefined;

  // zoom precedence: nested → deprecated flat (scoped) → legacy top-level.
  const zoom = isRoadmapZoom(nestedRoadmap?.zoom)
    ? nestedRoadmap?.zoom
    : isRoadmapZoom(scoped.roadmapZoom)
      ? scoped.roadmapZoom
      : isRoadmapZoom(preferences.roadmapZoom)
        ? preferences.roadmapZoom
        : undefined;

  // viewMode precedence: nested → deprecated flat (scoped). No top-level legacy.
  const viewMode = isRoadmapViewMode(nestedRoadmap?.viewMode)
    ? nestedRoadmap?.viewMode
    : isRoadmapViewMode(scoped.roadmapViewMode)
      ? scoped.roadmapViewMode
      : undefined;

  const result: WorkspacePreferences = {
    // backlog is a reserved placeholder for future scope.
    backlog: {} as BacklogPagePreferences,
  };
  if (activeTab !== undefined) {
    result.activeTab = activeTab;
  }
  const roadmap: RoadmapPagePreferences = {};
  if (zoom !== undefined) roadmap.zoom = zoom;
  if (viewMode !== undefined) roadmap.viewMode = viewMode;
  if (isFilters(nestedRoadmap?.filters)) {
    roadmap.filters = nestedRoadmap.filters;
  }
  if (typeof nestedRoadmap?.sprintFilter === "string") {
    roadmap.sprintFilter = nestedRoadmap.sprintFilter;
  }
  if (
    (ROADMAP_LANE_MODES as readonly unknown[]).includes(nestedRoadmap?.laneMode)
  ) {
    roadmap.laneMode = nestedRoadmap?.laneMode as RoadmapPagePreferences["laneMode"];
  }
  if (typeof nestedRoadmap?.showCriticalPath === "boolean") {
    roadmap.showCriticalPath = nestedRoadmap.showCriticalPath;
  }
  if (typeof nestedRoadmap?.autoCascade === "boolean") {
    roadmap.autoCascade = nestedRoadmap.autoCascade;
  }
  if (typeof nestedRoadmap?.gutter === "boolean") {
    roadmap.gutter = nestedRoadmap.gutter;
  }
  if (typeof nestedRoadmap?.showMilestones === "boolean") {
    roadmap.showMilestones = nestedRoadmap.showMilestones;
  }
  if (Object.keys(roadmap).length > 0) {
    result.roadmap = roadmap;
  }
  if (typeof scoped.lastBoardId === "string") {
    result.lastBoardId = scoped.lastBoardId;
  }
  // Backwards-compat mirror: legacy consumers (pre-U3) still read the flat
  // `roadmapZoom`/`roadmapViewMode` keys off this return value. The canonical
  // shape lives in `roadmap.*`; the flat keys here are deprecated and will be
  // dropped once U3 migrates the consumers.
  if (zoom !== undefined) result.roadmapZoom = zoom;
  if (viewMode !== undefined) result.roadmapViewMode = viewMode;
  return result;
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
  // Write-promotion shim: while consumers (U3 migration) still emit the
  // deprecated flat keys, route them into the nested roadmap.* shape so
  // we never persist the flat shape from this helper.
  const promotedRoadmap: RoadmapPagePreferences = {
    ...(patch.roadmap ?? {}),
  };
  if (patch.roadmap?.zoom === undefined && patch.roadmapZoom !== undefined) {
    promotedRoadmap.zoom = patch.roadmapZoom;
  }
  if (
    patch.roadmap?.viewMode === undefined &&
    patch.roadmapViewMode !== undefined
  ) {
    promotedRoadmap.viewMode = patch.roadmapViewMode;
  }

  const existing = preferences.workspaces?.[workspaceId] ?? {};
  const existingRoadmap = isRecord(existing.roadmap) ? existing.roadmap : {};
  const existingBacklog = isRecord(existing.backlog) ? existing.backlog : {};

  // Preserve the full existing entry (including any pre-existing legacy
  // flat `roadmapZoom`/`roadmapViewMode`). The patch itself never emits
  // those flat keys — we only write into the nested roadmap.* shape.
  // Deleting the pre-existing flat keys from the persisted row is a
  // future cleanup unit (server-side `||` merge cannot drop keys).
  const nextEntry: WorkspacePreferences = { ...existing };

  if (patch.activeTab !== undefined) {
    nextEntry.activeTab = patch.activeTab;
  }

  if (patch.lastBoardId !== undefined) {
    nextEntry.lastBoardId = patch.lastBoardId;
  }

  const hasRoadmapWrite =
    Object.keys(promotedRoadmap).length > 0 || patch.roadmap !== undefined;
  if (hasRoadmapWrite) {
    nextEntry.roadmap = {
      ...existingRoadmap,
      ...promotedRoadmap,
    };
  }

  if (patch.backlog !== undefined) {
    nextEntry.backlog = {
      ...existingBacklog,
      ...patch.backlog,
    } as BacklogPagePreferences;
  }

  return {
    workspaces: {
      ...(preferences.workspaces ?? {}),
      [workspaceId]: nextEntry,
    },
  };
}

export function getTimelinePreferences(
  preferences: Preferences,
): TimelinePreferences {
  const scoped = preferences.timeline ?? {};
  const out: TimelinePreferences = {};
  if (isFilters(scoped.filters)) out.filters = scoped.filters;
  if ((ROADMAP_LANE_MODES as readonly unknown[]).includes(scoped.laneMode)) {
    out.laneMode = scoped.laneMode as TimelinePreferences["laneMode"];
  }
  if (typeof scoped.gutter === "boolean") out.gutter = scoped.gutter;
  if (
    Array.isArray(scoped.collapsedWorkspaceIds) &&
    scoped.collapsedWorkspaceIds.every((id) => typeof id === "string")
  ) {
    out.collapsedWorkspaceIds = scoped.collapsedWorkspaceIds;
  }
  return out;
}

export function patchTimelinePreferences(
  preferences: Preferences,
  patch: TimelinePreferences,
): Partial<Preferences> {
  return {
    timeline: {
      ...(preferences.timeline ?? {}),
      ...patch,
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
