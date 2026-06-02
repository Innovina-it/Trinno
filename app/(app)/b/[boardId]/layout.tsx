import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { assertUuidOrNotFound } from "@/lib/route-uuid";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";
import { getWorkspace, listMembers } from "@/lib/queries/workspaces";
import { hasFlag } from "@/lib/feature-flags/has-flag";
import { BoardStoreProvider } from "@/stores/board-store";
import { SubtaskParentSyncPrompt } from "@/components/board/card/subtask-parent-sync-prompt";
import { BoardSyncMount } from "@/components/board/board-sync-mount";
import { BoardVisitMarker } from "@/components/board/board-visit-marker";
import { WorkspaceStoreProvider } from "@/components/workspace/workspace-store-provider";
import { GuestReadonlyBanner } from "@/components/workspace/guest-readonly-banner";
import {
  HydrationBoundary,
  type DehydratedWorkspaceCache,
} from "@/stores/workspace-cache-store";

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
  assertUuidOrNotFound(boardId);
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
  const sharedWorkspaceCacheEnabled = await hasFlag(
    snap.board.workspaceId,
    "shared_workspace_cache_v2",
  );
  const [sharedWorkspace, sharedMembers] = sharedWorkspaceCacheEnabled
    ? await Promise.all([
        getWorkspace(token, snap.board.workspaceId),
        listMembers(token, snap.board.workspaceId),
      ])
    : [null, []];
  const sharedState: DehydratedWorkspaceCache | null =
    sharedWorkspaceCacheEnabled
      ? {
          queries: [
            {
              queryKey: [
                "workspace-snapshot",
                snap.board.workspaceId,
                "snapshot",
              ] as const,
              data: {
                ...workspaceSnapshot,
                workspace: sharedWorkspace ?? {
                  id: snap.board.workspaceId,
                  name: "",
                  ownerId: "",
                  createdAt: snap.board.createdAt,
                },
                members: sharedMembers,
                featureFlags: sharedWorkspace?.featureFlags ?? {
                  shared_workspace_cache_v2: true,
                },
              },
              updatedAt: Date.now(),
            },
          ],
        }
      : null;

  const body = (
    <WorkspaceStoreProvider initial={workspaceSnapshot}>
      <GuestReadonlyBanner />
      <BoardVisitMarker
        workspaceId={snap.board.workspaceId}
        boardId={boardId}
      />
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
          workspaceProfiles: snap.workspaceProfiles,
          cardSubboards: snap.cardSubboards,
          cardLinkByCard: snap.cardLinkByCard,
        }}
      >
        {children}
        {modal}
        <SubtaskParentSyncPrompt />
        <BoardSyncMount boardId={boardId} />
      </BoardStoreProvider>
    </WorkspaceStoreProvider>
  );
  if (!sharedState) return body;
  return <HydrationBoundary state={sharedState}>{body}</HydrationBoundary>;
}
