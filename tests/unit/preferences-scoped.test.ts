import { describe, expect, it } from "vitest";

import {
  getBoardPreferences,
  getWorkspacePreferences,
  patchBoardPreferences,
  patchWorkspacePreferences,
} from "@/lib/preferences/scoped";
import { type Preferences } from "@/lib/preferences/types";

describe("scoped preferences", () => {
  it("reads workspace-scoped preferences with legacy flat fallback", () => {
    const preferences: Preferences = {
      activeTab: "roadmap",
      roadmapZoom: "month",
      workspaces: {
        "ws-1": { activeTab: "board" },
      },
    };

    expect(getWorkspacePreferences(preferences, "ws-1")).toMatchObject({
      activeTab: "board",
      roadmapZoom: "month",
    });
    expect(getWorkspacePreferences(preferences, "ws-2")).toMatchObject({
      activeTab: "roadmap",
      roadmapZoom: "month",
    });
  });

  it("patches a workspace without overwriting sibling workspaces", () => {
    const preferences: Preferences = {
      workspaces: {
        "ws-1": { activeTab: "roadmap", roadmapZoom: "week" },
        "ws-2": { activeTab: "board" },
      },
    };

    expect(
      patchWorkspacePreferences(preferences, "ws-1", {
        roadmapViewMode: "list",
      }),
    ).toEqual({
      workspaces: {
        "ws-1": {
          activeTab: "roadmap",
          roadmapZoom: "week",
          roadmapViewMode: "list",
        },
        "ws-2": { activeTab: "board" },
      },
    });
  });

  it("patches a board without overwriting sibling boards", () => {
    const preferences: Preferences = {
      boards: {
        "board-1": { sprintStripVisible: true },
        "board-2": { sprintStripVisible: false },
      },
    };

    expect(
      patchBoardPreferences(preferences, "board-1", {
        dataVisibilityFilters: { assignee: "all" },
      }),
    ).toEqual({
      boards: {
        "board-1": {
          sprintStripVisible: true,
          dataVisibilityFilters: { assignee: "all" },
        },
        "board-2": { sprintStripVisible: false },
      },
    });
  });

  it("reads valid board-scoped filters", () => {
    const filters = {
      types: ["task"],
      labelIds: [],
      due: null,
      assignedToMe: false,
      unassigned: false,
      scheduled: true,
      hideCompleted: false,
    };
    const preferences: Preferences = {
      boards: {
        "board-1": { filters },
      },
    };

    expect(getBoardPreferences(preferences, "board-1").filters).toEqual(filters);
  });
});
