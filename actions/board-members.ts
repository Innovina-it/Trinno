"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boardMembers, boards, workspaceMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  InviteBoardMemberInput,
  ChangeBoardMemberRoleInput,
  RemoveBoardMemberInput,
  AddBoardMembersByIdsInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";
import { listBoardMembersFor } from "@/lib/queries/workspaces";

type BoardMembersTx = Parameters<Parameters<typeof dbAsUser>[1]>[0];

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

/**
 * Plan errors-onboarding follow-up — emit a specific
 * ROLE_INSUFFICIENT message instead of leaving the user with the
 * RLS-empty-row "Forbidden" default when a non-admin tries to
 * manage board members. Valid managers: board admins OR workspace
 * owners/admins.
 */
async function assertCanManageBoardMembers(
  tx: BoardMembersTx,
  boardId: string,
  userId: string,
) {
  const [board] = await tx
    .select({ workspaceId: boards.workspaceId })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  if (!board) {
    throw new StructuredError("ACCESS_DENIED", "Forbidden");
  }

  const [boardMembership] = await tx
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(
      and(
        eq(boardMembers.boardId, boardId),
        eq(boardMembers.userId, userId),
      ),
    )
    .limit(1);
  if (boardMembership?.role === "admin") return;

  const [wsMembership] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, board.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (
    wsMembership?.role === "owner" ||
    wsMembership?.role === "admin"
  ) {
    return;
  }

  throw new StructuredError(
    "ROLE_INSUFFICIENT",
    "Only board admins or workspace owners/admins can manage board members.",
  );
}

export async function inviteBoardMemberImpl(
  token: string,
  input: { boardId: string; email: string; role: "admin" | "member" | "observer" },
) {
  const parsed = InviteBoardMemberInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await assertCanManageBoardMembers(tx, parsed.boardId, actorId);
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${parsed.email}) as id`,
    );
    const userId = (lookup as unknown as { id: string | null }[])[0]?.id;
    if (!userId)
      throw new StructuredError(
        "VALIDATION_ERROR",
        "No user with that email",
        { kind: "user-not-found" },
      );

    const [row] = await tx
      .insert(boardMembers)
      .values({ boardId: parsed.boardId, userId, role: parsed.role })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const existing = await tx
        .select()
        .from(boardMembers)
        .where(
          and(
            eq(boardMembers.boardId, parsed.boardId),
            eq(boardMembers.userId, userId),
          ),
        );
      if (existing.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
      return existing[0];
    }
    return row;
  });
}

export async function changeBoardMemberRoleImpl(
  token: string,
  input: {
    boardId: string;
    userId: string;
    role: "admin" | "member" | "observer";
  },
) {
  const parsed = ChangeBoardMemberRoleInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await assertCanManageBoardMembers(tx, parsed.boardId, actorId);
    const [row] = await tx
      .update(boardMembers)
      .set({ role: parsed.role })
      .where(
        and(
          eq(boardMembers.boardId, parsed.boardId),
          eq(boardMembers.userId, parsed.userId),
        ),
      )
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function removeBoardMemberImpl(
  token: string,
  input: { boardId: string; userId: string },
) {
  const parsed = RemoveBoardMemberInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await assertCanManageBoardMembers(tx, parsed.boardId, actorId);
    const r = await tx
      .delete(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId, parsed.boardId),
          eq(boardMembers.userId, parsed.userId),
        ),
      )
      .returning({ userId: boardMembers.userId });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  });
}

export async function inviteBoardMember(
  input: Parameters<typeof inviteBoardMemberImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await inviteBoardMemberImpl(token, input);
  revalidatePath(`/b/${input.boardId}/settings`);
  revalidatePath(`/b/${input.boardId}`);
  return r;
}

export async function changeBoardMemberRole(
  input: Parameters<typeof changeBoardMemberRoleImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await changeBoardMemberRoleImpl(token, input);
  revalidatePath(`/b/${input.boardId}/settings`);
  revalidatePath(`/b/${input.boardId}`);
  return r;
}

export async function removeBoardMember(
  input: Parameters<typeof removeBoardMemberImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  await removeBoardMemberImpl(token, input);
  revalidatePath(`/b/${input.boardId}/settings`);
  revalidatePath(`/b/${input.boardId}`);
}

// Bulk add board members by user id (no email lookup). Used by the
// PeoplePicker flow, which already resolved profile ids from search.
// onConflictDoNothing matches inviteBoardMemberImpl: re-adding an existing
// member is a no-op rather than an error.
export async function addBoardMembersByIdsImpl(
  token: string,
  input: {
    boardId: string;
    members: { userId: string; role: "admin" | "member" | "observer" }[];
  },
) {
  const parsed = AddBoardMembersByIdsInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await assertCanManageBoardMembers(tx, parsed.boardId, actorId);
    const rows = parsed.members.map((m) => ({
      boardId: parsed.boardId,
      userId: m.userId,
      role: m.role,
    }));
    const inserted = await tx
      .insert(boardMembers)
      .values(rows)
      .onConflictDoNothing()
      .returning();
    return inserted;
  });
}

export async function addBoardMembersByIds(
  input: Parameters<typeof addBoardMembersByIdsImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await addBoardMembersByIdsImpl(token, input);
  revalidatePath(`/b/${input.boardId}/settings`);
  revalidatePath(`/b/${input.boardId}`);
  return r;
}

// Read-only fetch used by the board members panel to patch itself on
// realtime events instead of refreshing the whole route. RLS scopes the
// result to boards the viewer can still see.
export async function fetchBoardMembers(input: { boardId: string }) {
  await requireUser();
  const token = (await getSessionToken())!;
  return listBoardMembersFor(token, input.boardId);
}
