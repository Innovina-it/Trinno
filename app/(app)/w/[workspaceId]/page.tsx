import { redirect } from "next/navigation";
import { assertUuidOrNotFound } from "@/lib/route-uuid";
import { getUserPreferences } from "@/actions/profile-preferences";
import { getWorkspacePreferences } from "@/lib/preferences/scoped";

// Plan #epic-as-kanban (Q12) — workspace landing redirects to the
// roadmap. The board grid moved to /w/{workspaceId}/boards.
export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  assertUuidOrNotFound(workspaceId);
  const preferences = await getUserPreferences().catch(() => ({}));
  const activeTab = getWorkspacePreferences(preferences, workspaceId).activeTab;
  redirect(
    activeTab === "board"
      ? `/w/${workspaceId}/boards`
      : `/w/${workspaceId}/roadmap`,
  );
}
