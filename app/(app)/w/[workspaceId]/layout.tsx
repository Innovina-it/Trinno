import { redirect } from "next/navigation";
import { getSessionToken, requireUser } from "@/lib/auth";
import { assertUuidOrNotFound } from "@/lib/route-uuid";
import { getWorkspace, listMembers } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { WorkspaceVisitMarker } from "@/components/workspace/workspace-visit-marker";
import { GuestReadonlyBanner } from "@/components/workspace/guest-readonly-banner";
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
  assertUuidOrNotFound(workspaceId);
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) redirect("/?notice=removed");
  // "active" must match every getWorkspaceSnapshot call in the /w subtree
  // (this layout + roadmap + backlog pages): React cache dedupes by args,
  // so a mixed full/active pair would fetch the snapshot twice per request.
  const [snapshot, members] = await Promise.all([
    getWorkspaceSnapshot(token, workspaceId, "active"),
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
      <WorkspaceVisitMarker workspaceId={workspaceId} />
      <WorkspaceStoreProvider initial={snapshot}>
        <GuestReadonlyBanner />
        {children}
      </WorkspaceStoreProvider>
    </HydrationBoundary>
  );
}
