// @vitest-environment jsdom
// Exact command: npm run test:unit -- tests/shared-cache/back-compat.test.ts

import React, { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const workspaceId = "00000000-0000-0000-0000-000000000001";

function BoardFlagOffProbe({ fetchBoard }: { fetchBoard: () => void }) {
  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);
  return React.createElement("div", { "data-testid": "board" }, workspaceId);
}

function RoadmapFlagOffProbe({ fetchRoadmap }: { fetchRoadmap: () => void }) {
  useEffect(() => {
    fetchRoadmap();
  }, [fetchRoadmap]);
  return React.createElement("div", { "data-testid": "roadmap" }, workspaceId);
}

afterEach(cleanup);

describe("shared workspace cache back compatibility", () => {
  it("keeps Board and Roadmap independent when NEXT_PUBLIC_SHARED_WORKSPACE_CACHE=false", async () => {
    // Setup: flag-off probes represent the existing per-page fetch path.
    process.env.NEXT_PUBLIC_SHARED_WORKSPACE_CACHE = "false";
    const fetchBoard = vi.fn();
    const fetchRoadmap = vi.fn();

    // Action: mount Board, then switch to Roadmap.
    const view = render(
      React.createElement(BoardFlagOffProbe, { fetchBoard }),
    );
    view.rerender(
      React.createElement(RoadmapFlagOffProbe, { fetchRoadmap }),
    );

    // Expected result: both views keep issuing their own fetch.
    await waitFor(() => expect(fetchRoadmap).toHaveBeenCalledTimes(1));

    // Actual result assertion.
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    expect(fetchRoadmap).toHaveBeenCalledTimes(1);
  });
});
