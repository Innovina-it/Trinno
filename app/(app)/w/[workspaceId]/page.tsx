import { redirect } from "next/navigation";

// Plan #epic-as-kanban (Q12) — workspace landing redirects to the
// roadmap. The board grid moved to /w/{workspaceId}/boards.
export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}/roadmap`);
}
