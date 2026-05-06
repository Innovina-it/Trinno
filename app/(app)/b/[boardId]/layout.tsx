import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { BoardStoreProvider } from "@/stores/board-store";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";

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
  // Snapshot returns null when RLS hides the row — meaning the board
  // either never existed or the viewer was just removed.  Redirect to
  // the home shell with a notice so the topnav reads it once and toasts
  // "you no longer have access".
  if (!snap) redirect("/?notice=removed");
  const workspaceSnapshot = await getWorkspaceSnapshot(
    token,
    snap.board.workspaceId,
  );

  return (
    <WorkspaceStoreProvider initial={workspaceSnapshot}>
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
          cardLinks: snap.cardLinks,
          components: snap.components,
          cardComponents: snap.cardComponents,
          cardVersions: snap.cardVersions,
          boardProfiles: snap.boardProfiles,
          boardMembers: snap.boardMembers,
        }}
      >
        {children}
        {modal}
      </BoardStoreProvider>
    </WorkspaceStoreProvider>
  );
}
