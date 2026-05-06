"use client";
import { BoardStoreProvider } from "@/stores/board-store";
import { WorkspaceStoreProvider } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { useBoardRealtime } from "@/hooks/use-board-realtime";
import { EpicKanbanView } from "./epic-kanban-view";
import type { EpicSnapshot } from "@/lib/queries/epic-children";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

// Plan #epic-as-kanban — client shell that mounts the workspace + board
// zustand stores around `EpicKanbanView`, then bridges both realtime
// hooks so CDC events keep the page fresh. Mirrors the pattern used by
// `app/(app)/b/[boardId]/layout.tsx` (workspace store outside, board
// store inside) — except here the board store only carries the epic +
// its direct children to keep the snapshot small. Per-list collections
// (labels, checklists, comments, etc.) are unused on this page; we pass
// empty arrays so the `BoardSnapshotInit` shape is satisfied.

export function EpicKanbanShell({
  workspaceId,
  initialEpic,
  initialWorkspace,
}: {
  workspaceId: string;
  initialEpic: EpicSnapshot;
  initialWorkspace: WorkspaceSnapshot;
}) {
  return (
    <WorkspaceStoreProvider initial={initialWorkspace}>
      <BoardStoreProvider
        initial={{
          boardId: initialEpic.epic.boardId,
          cards: [initialEpic.epic, ...initialEpic.children],
          lists: initialEpic.lists,
          // Empty per-list collections — board channel keeps cards fresh,
          // workspace channel keeps lists fresh; per-list collections aren't
          // rendered on this page.
          labels: [],
          cardLabels: [],
          cardMembers: [],
          checklists: [],
          checklistItems: [],
          comments: [],
          attachments: [],
          cardLinks: [],
          components: [],
          cardComponents: [],
          cardVersions: [],
          boardProfiles: [],
          boardMembers: [],
        }}
      >
        <RealtimeBridge
          workspaceId={workspaceId}
          boardId={initialEpic.epic.boardId}
        />
        <EpicKanbanView
          workspaceId={workspaceId}
          epicId={initialEpic.epic.id}
        />
      </BoardStoreProvider>
    </WorkspaceStoreProvider>
  );
}

function RealtimeBridge({
  workspaceId,
  boardId,
}: {
  workspaceId: string;
  boardId: string;
}) {
  // Workspace channel keeps `lists` (read by the view) fresh; board
  // channel (mounted with the epic's home board id) keeps `cards`
  // fresh. Without the board hook, cross-client moves wouldn't reach
  // the board store and wouldn't appear until reload.
  useWorkspaceRealtime(workspaceId);
  useBoardRealtime(boardId, workspaceId);
  return null;
}
