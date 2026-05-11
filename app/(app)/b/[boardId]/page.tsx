import { Suspense } from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { BoardView } from "@/components/board/board-view";
import { ActivityFeed } from "@/components/board/activity-feed";
import { ActivityFeedSync } from "@/components/board/activity-feed-sync";
import { ActivityShell } from "@/components/board/activity-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { recordBoardViewImpl } from "@/actions/favorites";
import { listSprintsForWorkspace } from "@/lib/queries/sprints";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const snap = await getBoardSnapshot(token, boardId);
  if (!snap) notFound();

  // Plan #16b-γ-C (#5) — best-effort record this board view. We don't
  // await the result block-then-render because the user shouldn't pay
  // for a write to see the board; failures are swallowed silently.
  void recordBoardViewImpl(token, { boardId }).catch(() => {});

  const [me] = await dbAsUser(token, async (tx) =>
    tx
      .select({
        displayName: profiles.displayName,
        avatarUrl: profiles.avatarUrl,
      })
      .from(profiles)
      .where(eq(profiles.id, user.id)),
  );
  const currentUser = {
    userId: user.id,
    displayName: me?.displayName ?? (user.email ?? "User"),
    avatarUrl: me?.avatarUrl ?? null,
  };

  // Plan #16b-γ-D (#8) — sprints feed the bulk action bar's "Set sprint"
  // dropdown. Cheap query (workspace-scoped) and not needed below the
  // fold; piped straight to the client component.
  const sprints = await listSprintsForWorkspace(token, snap.board.workspaceId);

  return (
    <BoardView
      board={snap.board}
      currentUser={currentUser}
      sprints={sprints.map((s) => ({ id: s.id, name: s.name, state: s.state }))}
    >
      <ActivityShell>
        <Suspense
          fallback={
            <aside className="w-[300px] shrink-0 rounded-2xl border border-hairline bg-[color:var(--bg-1)]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-hairline">
                <Skeleton className="h-3 w-16 bg-white/15" />
                <Skeleton className="h-3 w-6 bg-white/10" />
              </div>
              <div className="p-3 space-y-2.5">
                <Skeleton className="h-3 w-full bg-white/10" />
                <Skeleton className="h-3 w-5/6 bg-white/10" />
                <Skeleton className="h-3 w-4/6 bg-white/10" />
                <Skeleton className="h-3 w-5/6 bg-white/10" />
              </div>
            </aside>
          }
        >
          <ActivityFeed boardId={boardId} workspaceId={snap.board.workspaceId} />
        </Suspense>
        <ActivityFeedSync boardId={boardId} />
      </ActivityShell>
    </BoardView>
  );
}
