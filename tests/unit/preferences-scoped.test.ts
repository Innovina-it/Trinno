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
      roadmap: { zoom: "month" },
    });
    expect(getWorkspacePreferences(preferences, "ws-2")).toMatchObject({
      activeTab: "roadmap",
      roadmap: { zoom: "month" },
    });
  });

  it("patches a workspace without overwriting sibling workspaces", () => {
    const preferences: Preferences = {
      workspaces: {
        "ws-1": { activeTab: "roadmap", roadmap: { zoom: "week" } },
        "ws-2": { activeTab: "board" },
      },
    };

    expect(
      patchWorkspacePreferences(preferences, "ws-1", {
        roadmap: { viewMode: "list" },
      }),
    ).toEqual({
      workspaces: {
        "ws-1": {
          activeTab: "roadmap",
          roadmap: { zoom: "week", viewMode: "list" },
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

  // T1. read fallback — preferences contains only flat
  //     workspaces[wsA].roadmapZoom = "week" → getWorkspacePreferences
  //     returns roadmap.zoom === "week".
  it("T1 reads flat workspace.roadmapZoom into roadmap.zoom", () => {
    const preferences: Preferences = {
      workspaces: {
        "ws-a": { roadmapZoom: "week" },
      },
    };
    expect(getWorkspacePreferences(preferences, "ws-a").roadmap?.zoom).toBe(
      "week",
    );
  });

  // T2. read precedence — nested wins over flat.
  it("T2 prefers nested roadmap.zoom over deprecated flat roadmapZoom", () => {
    const preferences: Preferences = {
      workspaces: {
        "ws-a": { roadmapZoom: "week", roadmap: { zoom: "month" } },
      },
    };
    expect(getWorkspacePreferences(preferences, "ws-a").roadmap?.zoom).toBe(
      "month",
    );
  });

  // T3. read top-level legacy — preferences.roadmapZoom = "quarter" with
  //     no workspaces[wsA] entry → roadmap.zoom === "quarter".
  it("T3 falls back to top-level legacy roadmapZoom when nothing scoped", () => {
    const preferences: Preferences = {
      roadmapZoom: "quarter",
    };
    expect(getWorkspacePreferences(preferences, "ws-a").roadmap?.zoom).toBe(
      "quarter",
    );
  });

  // T4. write goes nested — patchWorkspacePreferences(prefs, wsA, {
  //       roadmap: { zoom: "fit" } }) → return shape contains
  //     workspaces[wsA].roadmap.zoom === "fit" and NO
  //     workspaces[wsA].roadmapZoom key in the patch's [wsA] sub-bag.
  it("T4 routes nested roadmap.zoom writes into the nested shape only", () => {
    const preferences: Preferences = {};
    const result = patchWorkspacePreferences(preferences, "ws-a", {
      roadmap: { zoom: "fit" },
    });
    const wsBag = result.workspaces?.["ws-a"] ?? {};
    expect(wsBag.roadmap?.zoom).toBe("fit");
    expect("roadmapZoom" in wsBag).toBe(false);
  });

  // T5. write promotion shim — patchWorkspacePreferences(prefs, wsA, {
  //       roadmapZoom: "fit" }) → still produces nested roadmap.zoom.
  it("T5 promotes legacy flat roadmapZoom into nested roadmap.zoom on write", () => {
    const preferences: Preferences = {};
    const result = patchWorkspacePreferences(preferences, "ws-a", {
      roadmapZoom: "fit",
    });
    const wsBag = result.workspaces?.["ws-a"] ?? {};
    expect(wsBag.roadmap?.zoom).toBe("fit");
    expect("roadmapZoom" in wsBag).toBe(false);
  });

  // T6. cross-workspace isolation — patching wsA.roadmap.zoom leaves
  //     wsB.roadmap.zoom untouched.
  it("T6 leaves sibling workspace roadmap untouched when patching one", () => {
    const preferences: Preferences = {
      workspaces: {
        "ws-a": { roadmap: { zoom: "week" } },
        "ws-b": { roadmap: { zoom: "month" } },
      },
    };
    const result = patchWorkspacePreferences(preferences, "ws-a", {
      roadmap: { zoom: "fit" },
    });
    expect(result.workspaces?.["ws-a"].roadmap?.zoom).toBe("fit");
    expect(result.workspaces?.["ws-b"].roadmap?.zoom).toBe("month");
  });

  // T7. backlog reader — getWorkspacePreferences(prefs, wsA).backlog
  //     deep-equals {}.
  it("T7 exposes a reserved empty backlog bag from the reader", () => {
    const preferences: Preferences = {};
    expect(getWorkspacePreferences(preferences, "ws-a").backlog).toEqual({});
  });
});
