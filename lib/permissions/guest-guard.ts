// Plan #0111 — guest-role write guard.
//
// 'guest' is a read-only workspace participant. The only mutation a
// guest may perform is moving a card between lists (changing its
// status) on cards where they are listed in card_members (i.e. cards
// assigned to them by another role). Everything else — invites, board
// creation, card create/update beyond listId, comments, labels,
// members, etc. — is rejected with GUEST_FORBIDDEN.
//
// Server actions funnel all mutations, so calling these guards inside
// each *Impl transaction is the choke point. The DB-level enum still
// includes guest (#0111) so RLS read policies that hinge on workspace
// membership existence keep granting read access.

import { and, eq } from "drizzle-orm";
import { cardMembers, cards, boards, workspaceMembers } from "@/lib/db/schema";
import { StructuredError } from "@/lib/errors";

type Tx = Parameters<Parameters<typeof import("@/lib/db/client").dbAsUser>[1]>[0];

export type WorkspaceRole = "owner" | "admin" | "member" | "guest" | null;

export async function getWorkspaceRole(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole> {
  const [row] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return (row?.role ?? null) as WorkspaceRole;
}

export async function getWorkspaceRoleForBoard(
  tx: Tx,
  boardId: string,
  userId: string,
): Promise<WorkspaceRole> {
  const [row] = await tx
    .select({ role: workspaceMembers.role })
    .from(boards)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, boards.workspaceId),
    )
    .where(and(eq(boards.id, boardId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return (row?.role ?? null) as WorkspaceRole;
}

export async function getWorkspaceRoleForCard(
  tx: Tx,
  cardId: string,
  userId: string,
): Promise<WorkspaceRole> {
  const [row] = await tx
    .select({ role: workspaceMembers.role })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, boards.workspaceId),
    )
    .where(and(eq(cards.id, cardId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return (row?.role ?? null) as WorkspaceRole;
}

export function isGuest(role: WorkspaceRole): boolean {
  return role === "guest";
}

/**
 * Reject any write attempted by a guest. Use at the top of mutation
 * impls that have no per-card exception.
 */
export function assertNotGuest(role: WorkspaceRole): void {
  if (role === "guest") {
    throw new StructuredError(
      "GUEST_FORBIDDEN",
      "Guests have read-only access; only the status of assigned cards may be changed.",
    );
  }
}

/**
 * Guest escape-hatch: allow listId change only when the guest is in
 * card_members for the target card. Pass `patchKeys` (the keys the
 * caller is trying to mutate) so non-status fields are rejected even
 * for assigned cards.
 *
 * Returns void on success, throws GUEST_FORBIDDEN otherwise.
 */
export async function assertGuestCardWriteAllowed(
  tx: Tx,
  role: WorkspaceRole,
  cardId: string,
  userId: string,
  patchKeys: readonly string[],
  opts: { allowedKeys?: readonly string[] } = {},
): Promise<void> {
  if (role !== "guest") return;

  const allowedKeys = opts.allowedKeys ?? (["listId"] as const);
  const disallowed = patchKeys.filter((k) => !allowedKeys.includes(k));
  if (disallowed.length > 0) {
    throw new StructuredError(
      "GUEST_FORBIDDEN",
      "Guests can only change the status (list) of assigned cards.",
      { disallowedFields: disallowed },
    );
  }

  const [assigned] = await tx
    .select({ userId: cardMembers.userId })
    .from(cardMembers)
    .where(
      and(eq(cardMembers.cardId, cardId), eq(cardMembers.userId, userId)),
    )
    .limit(1);
  if (!assigned) {
    throw new StructuredError(
      "GUEST_FORBIDDEN",
      "Guests can only change the status of cards assigned to them.",
    );
  }
}
