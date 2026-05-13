import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { BoardView } from "@/components/board/board-view";
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
    />
  );
}
