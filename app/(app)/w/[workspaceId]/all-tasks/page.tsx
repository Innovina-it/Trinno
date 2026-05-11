import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { AllTasksView } from "@/components/workspace/all-tasks-view";

export default async function AllTasksPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const snapshot = await getWorkspaceSnapshot(token, workspaceId);

  return (
    <WorkspaceStoreProvider initial={snapshot}>
      <div className="mx-auto max-w-[1600px] px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-6">
        <header className="space-y-3 border-b border-hairline pb-6">
          <span className="chip">{ws.name.toUpperCase()} / MY TASKS</span>
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="serif-display text-5xl">My tasks</h1>
            <span
              className="mono-meta text-fg-muted"
              data-testid="all-tasks-card-count"
            >
              {snapshot.cards.filter((c) => !c.archived).length} CARDS
            </span>
          </div>
          <Link
            href={`/w/${workspaceId}`}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← Back to workspace
          </Link>
        </header>
        <AllTasksView workspaceId={workspaceId} viewerId={user.id} />
      </div>
    </WorkspaceStoreProvider>
  );
}
