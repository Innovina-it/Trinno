import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getDashboard } from "@/lib/queries/dashboards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { AddGadgetButton } from "@/components/dashboard/add-gadget-dialog";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const dash = await getDashboard(token, dashboardId);
  if (!dash) notFound();
  const isOwner = dash.ownerId === user.id;
  const workspaces = await listWorkspaces(token);
  // Plan #16b-β — only personal-scope dashboards skip the workspace store.
  const snapshot = dash.workspaceId
    ? await getWorkspaceSnapshot(token, dash.workspaceId)
    : null;

  const body = (
    <div
      className="mx-auto max-w-7xl px-6 py-8 space-y-6"
      data-testid="dashboard-detail"
      data-dashboard-id={dash.id}
    >
      <header className="space-y-2 border-b border-hairline pb-4">
        <Link
          href="/dashboards"
          className="mono-meta-sm text-fg-muted hover:text-fg inline-flex items-center gap-1.5"
        >
          ← All dashboards
        </Link>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <span className="mono-meta-sm text-fg-faint">
              {dash.scope.toUpperCase()} DASHBOARD
              {!isOwner && " · READ ONLY"}
            </span>
            <h1 className="font-sans text-2xl font-bold tracking-tight text-fg truncate">
              {dash.name}
            </h1>
          </div>
          {isOwner && (
            <AddGadgetButton
              dashboardId={dashboardId}
              dashboardWorkspaceId={dash.workspaceId}
              workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
            />
          )}
        </div>
      </header>
      <DashboardGrid
        dashboardId={dashboardId}
        ownerId={dash.ownerId}
        viewerId={user.id}
        workspaceId={dash.workspaceId}
      />
    </div>
  );

  return snapshot ? (
    <WorkspaceStoreProvider initial={snapshot}>{body}</WorkspaceStoreProvider>
  ) : (
    body
  );
}
