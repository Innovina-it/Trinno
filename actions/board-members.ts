"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boardMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  InviteBoardMemberInput,
  ChangeBoardMemberRoleInput,
  RemoveBoardMemberInput,
} from "@/lib/validation";

export async function inviteBoardMemberImpl(
  token: string,
  input: { boardId: string; email: string; role: "admin" | "member" | "observer" },
) {
  const parsed = InviteBoardMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${parsed.email}) as id`,
    );
    const userId = (lookup as unknown as { id: string | null }[])[0]?.id;
    if (!userId) throw new Error("No user with that email");

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
      if (existing.length === 0) throw new Error("Forbidden");
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
  return dbAsUser(token, async (tx) => {
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
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function removeBoardMemberImpl(
  token: string,
  input: { boardId: string; userId: string },
) {
  const parsed = RemoveBoardMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId, parsed.boardId),
          eq(boardMembers.userId, parsed.userId),
        ),
      )
      .returning({ userId: boardMembers.userId });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function inviteBoardMember(
  input: Parameters<typeof inviteBoardMemberImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await inviteBoardMemberImpl(token, input);
  revalidatePath(`/b/${input.boardId}/settings`);
  return r;
}

export async function changeBoardMemberRole(
  input: Parameters<typeof changeBoardMemberRoleImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await changeBoardMemberRoleImpl(token, input);
  revalidatePath(`/b/${input.boardId}/settings`);
  return r;
}

export async function removeBoardMember(
  input: Parameters<typeof removeBoardMemberImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  await removeBoardMemberImpl(token, input);
  revalidatePath(`/b/${input.boardId}/settings`);
}
