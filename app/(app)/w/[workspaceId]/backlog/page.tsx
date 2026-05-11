import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listMembers } from "@/lib/queries/workspaces";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { BacklogClient } from "@/components/sprint/backlog-client";

export default async function BacklogPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  // Plan #16b-α (β concern fix) — backlog now reads sprints + cards from
  // the workspace store instead of from server-shaped props. Realtime
  // CDC echoes propagate live across tabs.
  const snapshot = await getWorkspaceSnapshot(token, workspaceId);
  const members = await listMembers(token, workspaceId);
  const currentMember = members.find((m) => m.userId === user.id);
  const canManageSprints =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  return (
    <WorkspaceStoreProvider initial={snapshot}>
      <BacklogClient
        workspaceId={workspaceId}
        workspaceName={ws.name}
        canManageSprints={canManageSprints}
      />
    </WorkspaceStoreProvider>
  );
}
