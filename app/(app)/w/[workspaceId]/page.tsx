import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace, listBoardsInWorkspace } from "@/lib/queries/workspaces";
import { BoardGrid } from "@/components/workspace/board-grid";
import { CreateBoardButton } from "@/components/workspace/create-board-dialog";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/format";

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

  return (
    <main className="space-y-8 py-2">
      {/* Hero header — oversized italic serif workspace name + mono metadata */}
      <header className="space-y-3">
        <div className="flex items-baseline gap-3">
          <span className="mono-meta-sm text-ink/40">No. 01</span>
          <span className="mono-meta-sm text-ink/30">—</span>
          <span className="mono-meta-sm text-ink/50">{today}</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-rule pb-6">
          <div className="space-y-2 min-w-0">
            <h1 className="serif-display text-[clamp(3rem,8vw,5.5rem)] text-ink truncate">
              {ws.name}
              <span aria-hidden className="text-signal">.</span>
            </h1>
            <p className="mono-meta text-ink/60">
              {visibleCount === 0
                ? "AWAITING FIRST BOARD"
                : `${visibleCount} BOARD${visibleCount === 1 ? "" : "S"} ON FILE`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button render={<Link href={`/w/${workspaceId}/settings`} />} nativeButton={false} variant="ghost" size="sm">
              Settings
            </Button>
            <CreateBoardButton workspaceId={workspaceId} />
          </div>
        </div>
      </header>

      <BoardGrid boards={boards} />
    </main>
  );
}
