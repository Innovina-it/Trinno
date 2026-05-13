import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, getWorkspaceRole, listBoardsInWorkspace, listEpicsInWorkspace } from "@/lib/queries/workspaces";
import { BoardGrid } from "@/components/workspace/board-grid";
import { BoardListRealtime } from "@/components/workspace/board-list-realtime";
import { CreateBoardButton } from "@/components/workspace/create-board-dialog";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/format";
import { listFavoriteBoardIds } from "@/lib/queries/favorites";

export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const [boards, epics, favoritedIds, role] = await Promise.all([
    listBoardsInWorkspace(token, workspaceId),
    listEpicsInWorkspace(token, workspaceId),
    listFavoriteBoardIds(token),
    getWorkspaceRole(token, workspaceId, user.id),
  ]);
  const canCreateBoards = role === "owner" || role === "admin";
  const visibleCount = boards.filter((b) => !b.archived).length;
  const today = shortDate(new Date());

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 sm:px-4 md:px-6 py-6 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div className="space-y-1 min-w-0">
          <span className="mono-meta-sm text-fg-faint">
            {visibleCount === 0
              ? "NO BOARDS YET"
              : `${visibleCount} ${visibleCount === 1 ? "BOARD" : "BOARDS"} · ${today}`}
          </span>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-fg truncate">
            {ws.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            render={<Link href={`/w/${workspaceId}/settings`} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
          >
            Settings
          </Button>
          {canCreateBoards ? (
            <CreateBoardButton workspaceId={workspaceId} />
          ) : null}
        </div>
      </header>

      <BoardGrid boards={boards} epics={epics} favoritedIds={favoritedIds} />
      <BoardListRealtime workspaceId={workspaceId} />
    </div>
  );
}
