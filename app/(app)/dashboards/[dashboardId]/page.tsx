import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getDashboard } from "@/lib/queries/dashboards";
import { listWorkspaces } from "@/lib/queries/workspaces";
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

  return (
    <div
      className="mx-auto max-w-7xl px-6 py-8 space-y-6"
      data-testid="dashboard-detail"
      data-dashboard-id={dash.id}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <Link
            href="/dashboards"
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← All dashboards
          </Link>
          <div className="mono-meta-sm text-fg-faint mt-2">
            {dash.scope.toUpperCase()} DASHBOARD
          </div>
          <h1 className="serif-display text-3xl mt-1">{dash.name}</h1>
        </div>
        {isOwner && (
          <AddGadgetButton
            dashboardId={dashboardId}
            dashboardWorkspaceId={dash.workspaceId}
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
          />
        )}
      </header>
      <DashboardGrid
        dashboardId={dashboardId}
        ownerId={dash.ownerId}
        viewerId={user.id}
        workspaceId={dash.workspaceId}
      />
    </div>
  );
}
