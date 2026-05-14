import { useMemo } from "react";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import type { FlagName } from "@/lib/feature-flags";
import { useWorkspaceCacheQuery } from "@/stores/workspace-cache-store";

export const workspaceSnapshotKeys = {
  all: ["workspace-snapshot"] as const,
  workspace: (workspaceId: string) =>
    [...workspaceSnapshotKeys.all, workspaceId] as const,
  snapshot: (workspaceId: string) =>
    [...workspaceSnapshotKeys.workspace(workspaceId), "snapshot"] as const,
  boards: (workspaceId: string) =>
    [...workspaceSnapshotKeys.workspace(workspaceId), "boards"] as const,
  members: (workspaceId: string) =>
    [...workspaceSnapshotKeys.workspace(workspaceId), "members"] as const,
};

export type SharedWorkspaceMetadata = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
};

export type SharedWorkspaceMember = {
  userId: string;
  role: "owner" | "admin" | "member" | string;
  displayName: string;
  avatarUrl: string | null;
};

export type WorkspaceFeatureFlags = Partial<Record<FlagName, boolean>>;

export type SharedWorkspaceSnapshot = WorkspaceSnapshot & {
  workspace: SharedWorkspaceMetadata;
  members: SharedWorkspaceMember[];
  featureFlags?: WorkspaceFeatureFlags;
};

export function useWorkspaceSnapshot(
  workspaceId: string,
): SharedWorkspaceSnapshot | undefined {
  return useWorkspaceCacheQuery<SharedWorkspaceSnapshot>(
    workspaceSnapshotKeys.snapshot(workspaceId),
  );
}

export function useBoards(workspaceId: string): WorkspaceSnapshot["boards"] {
  const snapshot = useWorkspaceSnapshot(workspaceId);
  return useMemo(() => snapshot?.boards ?? [], [snapshot]);
}

export function useMembers(workspaceId: string): SharedWorkspaceMember[] {
  const snapshot = useWorkspaceSnapshot(workspaceId);
  return useMemo(() => snapshot?.members ?? [], [snapshot]);
}
