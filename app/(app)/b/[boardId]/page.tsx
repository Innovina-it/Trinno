import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { BoardStoreProvider } from "@/stores/board-store";
import { BoardView } from "@/components/board/board-view";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const snap = await getBoardSnapshot(token, boardId);
  if (!snap) notFound();

  return (
    <BoardStoreProvider
      initial={{ boardId, lists: snap.lists, cards: snap.cards }}
    >
      <BoardView board={snap.board} />
    </BoardStoreProvider>
  );
}
