// Helper used by every /me dashboard query to exclude workspaces where
// the current user is a guest. Guests in a shared workspace must not
// see ANY of that workspace's content on their personal dashboard,
// even when they happen to be assignee/owner of a card there.

import { and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers } from "@/lib/db/schema";

/** Returns the workspace ids where the authed user has role='guest'.
 *  Used by /me query helpers to skip those workspaces wholesale. */
export async function listMyGuestWorkspaceIds(
  token: string,
  userId: string,
): Promise<string[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.role, "guest"),
        ),
      );
    return rows.map((r) => r.workspaceId);
  });
}
