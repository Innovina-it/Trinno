// @vitest-environment jsdom
// Exact command: npm run test:unit -- tests/shared-cache/cache-invalidation.test.ts

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

function makeSnapshot(title: string): SharedWorkspaceSnapshot {
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

describe("shared workspace cache invalidation", () => {
  it("updates Board and Roadmap consumers after shared cache invalidation", async () => {
    // Setup: seed a shared query with a refetcher that returns mutable card data.
    const queryClient = createWorkspaceQueryClient();
    const key = workspaceSnapshotKeys.snapshot(workspaceId);
    let title = "Initial card";
    const queryFn = vi.fn(async () => makeSnapshot(title));
    await queryClient.fetchQuery({ queryKey: key, queryFn });

    render(
      React.createElement(
        WorkspaceCacheProvider,
        { client: queryClient },
        React.createElement(
          React.Fragment,
          null,
          React.createElement(BoardProbe),
          React.createElement(RoadmapProbe),
        ),
      ),
    );

    // Action: simulate a card mutation and invalidate the workspace snapshot.
    title = "Updated card";
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceSnapshotKeys.workspace(workspaceId),
      });
    });

    // Expected result: both mounted views re-render from the refreshed cache.
    await waitFor(() => {
      expect(screen.getByTestId("board").textContent).toBe("Updated card");
    });

    // Actual result assertion.
    expect(screen.getByTestId("roadmap").textContent).toBe("Updated card");
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});
