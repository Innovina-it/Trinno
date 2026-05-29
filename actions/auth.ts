"use server";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { createSupabaseServer } from "@/lib/supabase/server";
import { dbAsUser } from "@/lib/db/client";
import { workspaceInvitations } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";

export async function logout() {
  const supa = await createSupabaseServer();
  await supa.auth.signOut();
  redirect("/login");
}

// After an invitee sets their password, resolve which workspace to drop them
// into (the most recent invitation that names them). RLS lets them read
// invitations for workspaces they now belong to.
export async function inviteWorkspaceRedirect(): Promise<string | null> {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: workspaceInvitations.workspaceId })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.userId, user.id))
      .orderBy(desc(workspaceInvitations.createdAt))
      .limit(1);
    return row?.workspaceId ?? null;
  });
}
