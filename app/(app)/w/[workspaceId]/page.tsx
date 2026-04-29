import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listBoardsInWorkspace } from "@/lib/queries/workspaces";
import { BoardGrid } from "@/components/workspace/board-grid";
import { CreateBoardButton } from "@/components/workspace/create-board-dialog";
import { Button } from "@/components/ui/button";

export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const boards = await listBoardsInWorkspace(token, workspaceId);

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ws.name}</h1>
          <p className="text-sm text-muted-foreground">
            {boards.filter(b => !b.archived).length === 0
              ? "Create a board to start organizing work."
              : `${boards.filter(b => !b.archived).length} board${boards.filter(b => !b.archived).length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button render={<Link href={`/w/${workspaceId}/settings`} />} nativeButton={false} variant="ghost" size="sm">
            Settings
          </Button>
          <CreateBoardButton workspaceId={workspaceId} />
        </div>
      </div>
      <BoardGrid boards={boards} />
    </main>
  );
}
