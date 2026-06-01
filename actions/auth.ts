"use server";
import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { createSupabaseServer } from "@/lib/supabase/server";
import { dbAsUser } from "@/lib/db/client";
import { workspaceInvitations } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function logout() {
  const supa = await createSupabaseServer();
  await supa.auth.signOut();
  redirect("/login");
}

export async function inviteWorkspaceRedirectImpl(token: string): Promise<string | null> {
  const userId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: workspaceInvitations.workspaceId })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.userId, userId))
      .orderBy(desc(workspaceInvitations.createdAt))
      .limit(1);
    return row?.workspaceId ?? null;
  });
}

export async function inviteWorkspaceRedirect(): Promise<string | null> {
  await requireUser();
  const token = (await getSessionToken())!;
  return inviteWorkspaceRedirectImpl(token);
}
