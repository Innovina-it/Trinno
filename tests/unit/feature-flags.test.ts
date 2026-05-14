// @vitest-environment jsdom

import React, { type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceCacheProvider,
  createWorkspaceQueryClient,
} from "@/stores/workspace-cache-store";
import {
  workspaceSnapshotKeys,
  type SharedWorkspaceSnapshot,
} from "@/lib/queries/workspace-snapshot-shared";
import { hasFlag } from "@/lib/feature-flags/has-flag";
import { useWorkspaceFlag } from "@/lib/feature-flags/use-workspace-flag";

const mocks = vi.hoisted(() => ({
  createSupabaseServer: vi.fn(),
  createSupabaseBrowser: vi.fn(),
  useParams: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServer: mocks.createSupabaseServer,
}));

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowser: mocks.createSupabaseBrowser,
}));

vi.mock("next/navigation", () => ({
  useParams: mocks.useParams,
}));

const workspaceId = "00000000-0000-0000-0000-000000000001";

function mockSupabaseRow(featureFlags: Record<string, boolean> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: featureFlags ? { feature_flags: featureFlags } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, maybeSingle };
}

function makeSnapshot(
  featureFlags: Record<string, boolean>,
): SharedWorkspaceSnapshot {
  const now = new Date("2026-05-14T00:00:00.000Z");
  return {
    workspaceId,
    workspace: { id: workspaceId, name: "WS", ownerId: "u1", createdAt: now },
    members: [],
    featureFlags,
    boards: [],
    lists: [],
    cards: [],
    sprints: [],
    components: [],
    cardComponents: [],
    versions: [],
    cardVersions: [],
    cardLinks: [],
    cardMembers: [],
    workspaceProfiles: [],
  };
}

beforeEach(() => {
  mocks.createSupabaseServer.mockReset();
  mocks.createSupabaseBrowser.mockReset();
  mocks.useParams.mockReset();
  mocks.useParams.mockReturnValue({ workspaceId });
});

afterEach(() => {
  cleanup();
});

describe("workspace feature flags", () => {
  it("hasFlag returns true when column has the flag set true", async () => {
    const supabase = mockSupabaseRow({ shared_workspace_cache_v2: true });
    mocks.createSupabaseServer.mockResolvedValue(supabase);

    await expect(
      hasFlag(workspaceId, "shared_workspace_cache_v2"),
    ).resolves.toBe(true);
    expect(supabase.from).toHaveBeenCalledWith("workspaces");
    expect(supabase.select).toHaveBeenCalledWith("feature_flags");
    expect(supabase.eq).toHaveBeenCalledWith("id", workspaceId);
  });

  it("hasFlag returns fallback when key is missing", async () => {
    const supabase = mockSupabaseRow({});
    mocks.createSupabaseServer.mockResolvedValue(supabase);

    await expect(
      hasFlag(workspaceId, "shared_workspace_cache_v2", true),
    ).resolves.toBe(true);
  });

  it("hasFlag returns false when flag is set false", async () => {
    const supabase = mockSupabaseRow({ shared_workspace_cache_v2: false });
    mocks.createSupabaseServer.mockResolvedValue(supabase);

    await expect(
      hasFlag(workspaceId, "shared_workspace_cache_v2", true),
    ).resolves.toBe(false);
  });

  it("useWorkspaceFlag returns cached value from shared snapshot", () => {
    const queryClient = createWorkspaceQueryClient();
    queryClient.setQueryData(
      workspaceSnapshotKeys.snapshot(workspaceId),
      makeSnapshot({ shared_workspace_cache_v2: true }),
    );
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(
        WorkspaceCacheProvider,
        { client: queryClient },
        children,
      );

    const { result } = renderHook(
      () => useWorkspaceFlag("shared_workspace_cache_v2"),
      { wrapper },
    );

    expect(result.current).toBe(true);
    expect(mocks.createSupabaseBrowser).not.toHaveBeenCalled();
  });
});
