import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";
import { BoardView } from "@/components/board/board-view";

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

  return <BoardView board={snap.board} currentUser={currentUser} />;
}
