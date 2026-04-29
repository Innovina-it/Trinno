import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { BoardStoreProvider } from "@/stores/board-store";

export default async function BoardLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const snap = await getBoardSnapshot(token, boardId);
  if (!snap) notFound();

  return (
    <BoardStoreProvider
      initial={{
        boardId,
        lists: snap.lists,
        cards: snap.cards,
        labels: snap.labels,
        cardLabels: snap.cardLabels,
        cardMembers: snap.cardMembers,
        checklists: snap.checklists,
        checklistItems: snap.checklistItems,
        comments: snap.comments,
        attachments: snap.attachments,
        boardProfiles: snap.boardProfiles,
      }}
    >
      {children}
      {modal}
    </BoardStoreProvider>
  );
}
