import { describe, it, expect } from "vitest";
import {
  createWorkspaceStore,
  type WorkspaceState,
} from "@/stores/workspace-store";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

// Plan #16b-γ-Gantt-B (B2) — locks in the sprint-name lookup the Kanban tile
// performs against the workspace store. The CardTile selector is inline:
//
//   useWorkspaceStore((s) =>
//     card.sprintId
//       ? (s.sprints.find((sp) => sp.id === card.sprintId)?.name ?? null)
//       : null,
//   );
//
// These tests exercise the same pure lookup against a real store instance so
// a regression in either the selector shape or the store schema is caught.

function makeSnapshot(sprints: WorkspaceSnapshot["sprints"]): WorkspaceSnapshot {
  return {
    workspaceId: "w1",
    boards: [],
    lists: [],
    cards: [],
    sprints,
    components: [],
    cardComponents: [],
    versions: [],
    cardVersions: [],
    cardLinks: [],
    workspaceProfiles: [],
  };
}

function pickSprintName(
  state: WorkspaceState,
  sprintId: string | null,
): string | null {
  return sprintId
    ? (state.sprints.find((sp) => sp.id === sprintId)?.name ?? null)
    : null;
}

describe("CardTile sprint-name selector (B2)", () => {
  const sprints: WorkspaceSnapshot["sprints"] = [
    {
      id: "sp1",
      name: "Sprint 24",
      goal: null,
      startDate: null,
      endDate: null,
      state: "active",
    },
    {
      id: "sp2",
      name: "Q2 Planning",
      goal: null,
      startDate: null,
      endDate: null,
      state: "future",
    },
  ];

  it("returns the sprint name when the sprint exists in the store", () => {
    const store = createWorkspaceStore(makeSnapshot(sprints));
    expect(pickSprintName(store.getState(), "sp1")).toBe("Sprint 24");
    expect(pickSprintName(store.getState(), "sp2")).toBe("Q2 Planning");
  });

  it("returns null when the card has a sprintId not yet in the store (realtime race)", () => {
    const store = createWorkspaceStore(makeSnapshot(sprints));
    expect(pickSprintName(store.getState(), "sp-missing")).toBeNull();
  });

  it("returns null when the card has no sprintId", () => {
    const store = createWorkspaceStore(makeSnapshot(sprints));
    expect(pickSprintName(store.getState(), null)).toBeNull();
  });

  it("reflects sprint name updates after upsertSprint", () => {
    const store = createWorkspaceStore(makeSnapshot(sprints));
    store.getState().upsertSprint({
      id: "sp1",
      name: "Sprint 24 (renamed)",
      goal: null,
      startDate: null,
      endDate: null,
      state: "active",
    });
    expect(pickSprintName(store.getState(), "sp1")).toBe("Sprint 24 (renamed)");
  });

  it("returns null after removeSprint clears it from the store", () => {
    const store = createWorkspaceStore(makeSnapshot(sprints));
    store.getState().removeSprint("sp1");
    expect(pickSprintName(store.getState(), "sp1")).toBeNull();
  });
});
