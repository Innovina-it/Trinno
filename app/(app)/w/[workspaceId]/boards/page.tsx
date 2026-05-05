import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listBoardsInWorkspace } from "@/lib/queries/workspaces";
import { BoardGrid } from "@/components/workspace/board-grid";
import { CreateBoardButton } from "@/components/workspace/create-board-dialog";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/format";
import { computeVelocity } from "@/lib/queries/sprints-stats";
import { VelocityStrip } from "@/components/sprint/velocity-strip";
import { listFavoriteBoardIds } from "@/lib/queries/favorites";

export default async function WorkspacePage({
  params,
}: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const boards = await listBoardsInWorkspace(token, workspaceId);
  const visibleCount = boards.filter((b) => !b.archived).length;
  const today = shortDate(new Date());
  const velocity = await computeVelocity(token, workspaceId, 6);
  const favoritedIds = await listFavoriteBoardIds(token);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
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
          <CreateBoardButton workspaceId={workspaceId} />
        </div>
      </header>

      <BoardGrid boards={boards} favoritedIds={favoritedIds} />

      {visibleCount > 0 && (
        <details className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4">
          <summary className="cursor-pointer mono-meta-sm text-fg-muted hover:text-fg">
            Velocity (last 6 sprints)
          </summary>
          <div className="mt-3">
            <VelocityStrip data={velocity} />
          </div>
        </details>
      )}
    </div>
  );
}
