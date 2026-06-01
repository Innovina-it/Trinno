import { describe, it, expect } from "vitest";
import {
  createWorkspaceStore,
  type WorkspaceState,
} from "@/stores/workspace-store";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { getCardStatusKind } from "@/lib/status";

// Plan #16b-γ-Gantt-B (B3) — locks in the status-kind lookup the Kanban tile
// performs against the workspace store. The CardTile selector is inline:
//
//   useWorkspaceStore((s) =>
//     getCardStatusKind({ listId: card.listId }, s.lists),
//   );
//
// These tests exercise the same pure lookup against a real store instance so
// a regression in either the selector shape or the store schema is caught.

function makeSnapshot(lists: WorkspaceSnapshot["lists"]): WorkspaceSnapshot {
  return {
    workspaceId: "w1",
    viewerId: "u1",
    viewerRole: "owner",
    autoAssignCreator: false,
    boards: [],
    lists,
    cards: [],
    sprints: [],
    components: [],
    cardComponents: [],
    versions: [],
    cardVersions: [],
    cardLinks: [],
    cardMembers: [],
    workspaceProfiles: [],
    subBoards: [],
  };
}

function pickStatusKind(state: WorkspaceState, card: { listId: string }) {
  return getCardStatusKind({ listId: card.listId }, state.lists);
}

describe("CardTile status-kind selector (B3)", () => {
  const lists: WorkspaceSnapshot["lists"] = [
    { id: "l1", boardId: "b1", title: "In progress", position: "a0", statusKind: "in_progress" },
    { id: "l2", boardId: "b1", title: "Notes", position: "a1", statusKind: null },
    { id: "l3", boardId: "b1", title: "Done", position: "a2", statusKind: "done" },
  ];

  it("returns the statusKind of the card's list when set", () => {
    const store = createWorkspaceStore(makeSnapshot(lists));
    expect(pickStatusKind(store.getState(), { listId: "l1" })).toBe(
      "in_progress",
    );
    expect(pickStatusKind(store.getState(), { listId: "l3" })).toBe("done");
  });

  it("returns null when the list has statusKind: null (unmapped)", () => {
    const store = createWorkspaceStore(makeSnapshot(lists));
    expect(pickStatusKind(store.getState(), { listId: "l2" })).toBeNull();
  });

  it("returns null when the card.listId is not in the store (CDC race)", () => {
    const store = createWorkspaceStore(makeSnapshot(lists));
    expect(
      pickStatusKind(store.getState(), { listId: "l-missing" }),
    ).toBeNull();
  });

  it("reflects status updates after patchList", () => {
    const store = createWorkspaceStore(makeSnapshot(lists));
    store.getState().patchList("l1", { statusKind: "review" });
    expect(pickStatusKind(store.getState(), { listId: "l1" })).toBe("review");

    store.getState().patchList("l2", { statusKind: "blocked" });
    expect(pickStatusKind(store.getState(), { listId: "l2" })).toBe("blocked");
  });

  it("returns null after removeList clears the list from the store", () => {
    const store = createWorkspaceStore(makeSnapshot(lists));
    store.getState().removeList("l1");
    expect(pickStatusKind(store.getState(), { listId: "l1" })).toBeNull();
  });
});
