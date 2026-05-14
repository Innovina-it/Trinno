import { redirect } from "next/navigation";
import { getSessionToken, requireUser } from "@/lib/auth";
import { getWorkspace, listMembers } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { hasFlag } from "@/lib/feature-flags/has-flag";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import {
  HydrationBoundary,
  type DehydratedWorkspaceCache,
} from "@/stores/workspace-cache-store";

// Single guard for every page under /w/<id>/*: if RLS hides the
// workspace row (membership revoked, or the id never existed for this
// user), bounce out to "/" with a notice the topnav toasts once.  Each
// child page can keep its own `notFound()` for sub-resources (epic,
// sprint, version) — those still mean "doesn't exist", not "evicted".
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) redirect("/?notice=removed");
  const sharedWorkspaceCacheEnabled = await hasFlag(
    workspaceId,
    "shared_workspace_cache_v2",
  );
  if (!sharedWorkspaceCacheEnabled) return <>{children}</>;

  const [snapshot, members] = await Promise.all([
    getWorkspaceSnapshot(token, workspaceId),
    listMembers(token, workspaceId),
  ]);
  const sharedSnapshot = {
    ...snapshot,
    workspace: {
      id: ws.id,
      name: ws.name,
      ownerId: ws.ownerId,
      createdAt: ws.createdAt,
    },
    members,
    featureFlags: ws.featureFlags,
  };
  const state: DehydratedWorkspaceCache = {
    queries: [
      {
        queryKey: ["workspace-snapshot", workspaceId, "snapshot"] as const,
        data: sharedSnapshot,
        updatedAt: Date.now(),
      },
    ],
  };

  return (
    <HydrationBoundary state={state}>
      <WorkspaceStoreProvider initial={snapshot}>{children}</WorkspaceStoreProvider>
    </HydrationBoundary>
  );
}
