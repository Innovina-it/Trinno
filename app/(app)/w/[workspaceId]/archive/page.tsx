import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import { listWorkspaceArchive } from "@/lib/queries/archived";
import { ArchiveView } from "@/components/archive/archive-view";

export default async function ArchivePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const archive = await listWorkspaceArchive(token, workspaceId);
  const total = archive.cards.length + archive.lists.length + archive.boards.length;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-3 sm:px-4 md:px-6 py-6 md:py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{ws.name}: Archive</h1>
        <p className="mono-meta-sm text-fg-faint">
          {total} archived item{total === 1 ? "" : "s"}
        </p>
      </header>
      <ArchiveView archive={archive} workspaceId={workspaceId} />
    </div>
  );
}
