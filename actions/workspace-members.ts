"use server";
import { revalidatePath } from "next/cache";
import { sql, and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  InviteMemberInput, ChangeMemberRoleInput, RemoveMemberInput,
} from "@/lib/validation";

export async function inviteMemberImpl(
  token: string,
  input: { workspaceId: string; email: string; role: "admin" | "member" },
) {
  const parsed = InviteMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const lookup = await tx.execute(
      sql`select public.find_user_id_by_email(${parsed.email}) as id`,
    );
    const userId = (lookup as unknown as { id: string | null }[])[0]?.id;
    if (!userId) throw new Error("No user with that email");

    const [row] = await tx.insert(workspaceMembers)
      .values({ workspaceId: parsed.workspaceId, userId, role: parsed.role })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const existing = await tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, userId),
      ));
      if (existing.length === 0) throw new Error("Forbidden");
      return existing[0];
    }
    return row;
  });
}

export async function changeMemberRoleImpl(
  token: string,
  input: { workspaceId: string; userId: string; role: "owner" | "admin" | "member" },
) {
  const parsed = ChangeMemberRoleInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(workspaceMembers)
      .set({ role: parsed.role })
      .where(and(
        eq(workspaceMembers.workspaceId, parsed.workspaceId),
        eq(workspaceMembers.userId, parsed.userId),
      ))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function removeMemberImpl(
  token: string,
  input: { workspaceId: string; userId: string },
) {
  const parsed = RemoveMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, parsed.workspaceId),
      eq(workspaceMembers.userId, parsed.userId),
    )).returning({ userId: workspaceMembers.userId });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function inviteMember(input: Parameters<typeof inviteMemberImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await inviteMemberImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}/settings`);
  return r;
}
export async function changeMemberRole(input: Parameters<typeof changeMemberRoleImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await changeMemberRoleImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}/settings`);
  return r;
}
export async function removeMember(input: Parameters<typeof removeMemberImpl>[1]) {
  await requireUser();
  const token = (await getSessionToken())!;
  await removeMemberImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}/settings`);
}
