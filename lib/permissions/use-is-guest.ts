"use client";
// Plan #0111 — UI affordance gating for workspace guests.
//
// Server already rejects every write a guest can't perform (the
// `guest-guard.ts` helpers wrap each mutation). These hooks are the
// client-side counterpart: hide / disable the buttons + inputs so a
// guest never sees an affordance that would only produce a toast.
//
// Read access doesn't move through these hooks — guest is a normal
// workspace member for reads.

import { useBoardStore } from "@/stores/board-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/** True when the viewer's workspace role is `guest`. */
export function useIsGuest(): boolean {
  return useWorkspaceStore((s) => s.viewerRole === "guest");
}

/** Viewer user id (workspace scope). */
export function useViewerId(): string {
  return useWorkspaceStore((s) => s.viewerId);
}

/**
 * Returns true when the viewer (a guest) is allowed to change the
 * status of `cardId` — i.e. they're in `card_members` for that card.
 * Non-guests always return true. Use this to keep the status-move
 * affordance (drag, move-to-status) visible only on assigned cards.
 *
 * Reads from the BoardStore's `cardMembers`, so callers must be
 * inside a BoardStoreProvider.
 */
export function useGuestCanMoveCard(cardId: string): boolean {
  const isGuest = useIsGuest();
  const viewerId = useViewerId();
  const assigned = useBoardStore((s) =>
    s.cardMembers.some((m) => m.cardId === cardId && m.userId === viewerId),
  );
  return !isGuest || assigned;
}

/**
 * Mirror of `useGuestCanMoveCard` for surfaces that read from the
 * WorkspaceStore (roadmap, backlog, all-tasks) where the BoardStore is
 * not mounted.
 */
export function useGuestCanMoveCardWorkspace(cardId: string): boolean {
  const isGuest = useIsGuest();
  const viewerId = useViewerId();
  const assigned = useWorkspaceStore((s) =>
    s.cardMembers.some((m) => m.cardId === cardId && m.userId === viewerId),
  );
  return !isGuest || assigned;
}
