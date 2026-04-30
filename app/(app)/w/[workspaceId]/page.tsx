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

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-6 py-10">
      {/* Hero header — oversized italic serif workspace name with gradient noun */}
      <header className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span className="chip">No. 01</span>
          <span className="mono-meta-sm text-fg-faint">{today}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-8">
          <div className="space-y-3 min-w-0">
            <h1 className="serif-display gradient-text text-[clamp(3rem,8vw,5.5rem)] leading-[0.95] truncate">
              {ws.name}
              <span aria-hidden className="text-fg/80">.</span>
            </h1>
            <div className="flex items-center gap-3">
              <span className="block h-px w-10 bg-gradient-to-r from-accent-cyan to-accent-magenta" />
              <p className="mono-meta text-fg-muted">
                {visibleCount === 0
                  ? "AWAITING FIRST BOARD"
                  : `${visibleCount} BOARD${visibleCount === 1 ? "" : "S"} ON FILE`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button render={<Link href={`/w/${workspaceId}/settings`} />} nativeButton={false} variant="ghost" size="sm">
              Settings
            </Button>
            <CreateBoardButton workspaceId={workspaceId} />
          </div>
        </div>
      </header>

      <VelocityStrip data={velocity} />

      <BoardGrid boards={boards} />
    </div>
  );
}
