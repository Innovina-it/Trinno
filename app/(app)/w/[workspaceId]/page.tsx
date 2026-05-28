import { redirect } from "next/navigation";
import { assertUuidOrNotFound } from "@/lib/route-uuid";
import { getSessionToken } from "@/lib/auth";
import { getUserPreferences } from "@/actions/profile-preferences";
import { getWorkspacePreferences } from "@/lib/preferences/scoped";
import { listBoardsInWorkspace } from "@/lib/queries/workspaces";

// Plan #epic-as-kanban (Q12) — workspace landing redirects to the
// roadmap. The board grid moved to /w/{workspaceId}/boards.
export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  assertUuidOrNotFound(workspaceId);
  const preferences = await getUserPreferences().catch(() => ({}));
  const scoped = getWorkspacePreferences(preferences, workspaceId);
  const activeTab = scoped.activeTab;

  if (activeTab === "board") {
    const lastBoardId = scoped.lastBoardId;
    if (lastBoardId) {
      // Validate the saved board still lives in this workspace and the
      // viewer can see it (RLS). Stale id (deleted, moved, archived,
      // membership revoked) → fall through to the board picker.
      const token = (await getSessionToken())!;
      const boards = await listBoardsInWorkspace(token, workspaceId).catch(
        () => [],
      );
      const match = boards.find(
        (b) => b.id === lastBoardId && !b.archived,
      );
      if (match) redirect(`/b/${lastBoardId}`);
    }
    redirect(`/w/${workspaceId}/boards`);
  }
  redirect(`/w/${workspaceId}/roadmap`);
}
