import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listEpicChildren } from "@/lib/queries/epic-children";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { EpicKanbanShell } from "@/components/epic/epic-kanban-shell";

// Plan #epic-as-kanban — SSR page for /w/[workspaceId]/e/[epicId]. Loads
// the epic + its direct children + the home-board lists in one snapshot,
// loads the workspace snapshot for the workspace store, and hands both
// to the client shell.

export default async function EpicKanbanPage({
  params,
}: {
  params: Promise<{ workspaceId: string; epicId: string }>;
}) {
  const { workspaceId, epicId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const epic = await listEpicChildren(token, epicId);
  if (!epic) notFound();
  const ws = await getWorkspaceSnapshot(token, workspaceId);
  return (
    <EpicKanbanShell
      workspaceId={workspaceId}
      initialEpic={epic}
      initialWorkspace={ws}
    />
  );
}
