"use client";
import { BoardStoreProvider } from "@/stores/board-store";
import { WorkspaceStoreProvider } from "@/stores/workspace-store";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { EpicKanbanView } from "./epic-kanban-view";
import type { EpicSnapshot } from "@/lib/queries/epic-children";
import type { WorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

// Plan #epic-as-kanban — client shell that mounts the workspace + board
// zustand stores around `EpicKanbanView`, then bridges
// `useWorkspaceRealtime` so CDC events keep the page fresh. Mirrors the
// pattern used by `app/(app)/b/[boardId]/layout.tsx` (workspace store
// outside, board store inside) — except here the board store only carries
// the epic + its direct children to keep the snapshot small. Per-list
// collections (labels, checklists, comments, etc.) are unused on this
// page; we pass empty arrays so the `BoardSnapshotInit` shape is satisfied.

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
          // Empty per-list collections — the workspace channel keeps cards
          // fresh; per-list collections aren't needed on this page.
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
        }}
      >
        <RealtimeBridge workspaceId={workspaceId} />
        <EpicKanbanView
          workspaceId={workspaceId}
          epicId={initialEpic.epic.id}
        />
      </BoardStoreProvider>
    </WorkspaceStoreProvider>
  );
}

function RealtimeBridge({ workspaceId }: { workspaceId: string }) {
  useWorkspaceRealtime(workspaceId);
  return null;
}
