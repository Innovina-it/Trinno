// @vitest-environment jsdom
// Exact command: npm run test:unit -- tests/shared-cache/golden.test.ts

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  WorkspaceCacheProvider,
  createWorkspaceQueryClient,
} from "@/stores/workspace-cache-store";
import {
  useWorkspaceSnapshot,
  workspaceSnapshotKeys,
  type SharedWorkspaceSnapshot,
} from "@/lib/queries/workspace-snapshot-shared";

const workspaceId = "00000000-0000-0000-0000-000000000001";

function makeSnapshot(title = "Shared card"): SharedWorkspaceSnapshot {
  const now = new Date("2026-05-14T00:00:00.000Z");
  return {
    workspaceId,
    workspace: { id: workspaceId, name: "WS", ownerId: "u1", createdAt: now },
    members: [{ userId: "u1", role: "owner", displayName: "Ada", avatarUrl: null }],
    boards: [
      {
        id: "board-1",
        title: "Board",
        archived: false,
        backgroundKind: "color",
        backgroundValue: "#000000",
      },
    ],
    lists: [
      {
        id: "list-1",
        boardId: "board-1",
        title: "Todo",
        position: "a0",
        statusKind: "todo",
      },
    ],
    cards: [
      {
        id: "card-1",
        boardId: "board-1",
        listId: "list-1",
        title,
        description: null,
        type: "task",
        parentCardId: null,
        sprintId: null,
        storyPoints: null,
        startDate: now,
        targetDate: now,
        dueDate: null,
        dueComplete: false,
        archived: false,
        createdAt: now,
        position: "a0",
        roadmapOrder: null,
        priority: null,
        ownerId: null,
        completedAt: null,
      },
    ],
    sprints: [],
    components: [],
    cardComponents: [],
    versions: [],
    cardVersions: [],
    cardLinks: [],
    cardMembers: [],
    workspaceProfiles: [{ id: "u1", displayName: "Ada" }],
    subBoards: [],
  };
}

function BoardProbe() {
  const snapshot = useWorkspaceSnapshot(workspaceId);
  return React.createElement("div", { "data-testid": "board" }, snapshot?.cards[0]?.title);
}

function RoadmapProbe() {
  const snapshot = useWorkspaceSnapshot(workspaceId);
  return React.createElement("div", { "data-testid": "roadmap" }, snapshot?.cards[0]?.title);
}

afterEach(cleanup);

describe("shared workspace cache golden path", () => {
  it("mounts Board then Roadmap with one shared fetchQuery call total", async () => {
    // Setup: mock the layout-level network fetch/query client seed.
    const queryClient = createWorkspaceQueryClient();
    const fetchSpy = vi.spyOn(queryClient, "fetchQuery");
    const key = workspaceSnapshotKeys.snapshot(workspaceId);
    await queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => makeSnapshot(),
    });

    // Action: mount a Board-like consumer, then switch to a Roadmap-like consumer.
    const view = render(
      React.createElement(
        WorkspaceCacheProvider,
        { client: queryClient },
        React.createElement(BoardProbe),
      ),
    );
    view.rerender(
      React.createElement(
        WorkspaceCacheProvider,
        { client: queryClient },
        React.createElement(RoadmapProbe),
      ),
    );

    // Expected result: the second mount makes zero new shared-query calls.
    const sharedCalls = fetchSpy.mock.calls.filter(
      ([arg]) => JSON.stringify(arg.queryKey) === JSON.stringify(key),
    );

    // Actual result assertion.
    expect(screen.getByTestId("roadmap").textContent).toBe("Shared card");
    expect(sharedCalls).toHaveLength(1);
  });
});
