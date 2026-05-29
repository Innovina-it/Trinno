// Helper used by /me dashboard queries to find workspaces where the
// current user is a guest. Guests must not see a shared workspace's
// general content on their personal dashboard (sprints, watchlist,
// inbox, owned cards). The ONE exception: cards explicitly assigned to
// them (a card_members row) still surface — those query branches omit
// this filter on purpose. See callers for the owner-keep/member-drop split.

import { and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers } from "@/lib/db/schema";

/** Returns the workspace ids where the authed user has role='guest'.
 *  Used by /me query helpers to skip those workspaces wholesale. */
export async function listMyGuestWorkspaceIds(
  token: string,
  userId: string,
): Promise<string[]> {
  try {
    return await dbAsUser(token, async (tx) => {
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
  } catch (error) {
    // Non-fatal: this lookup must never take down the /me dashboard. A
    // failure here (e.g. a database whose workspace_role enum is missing
    // the 'guest' value) is logged for diagnosis, then we degrade safely
    // to "no guest workspaces". Worst case the dashboard does not filter
    // out guest workspaces, rather than 500-ing the whole page.
    console.error(
      `[me-guard] listMyGuestWorkspaceIds failed for user ${userId}; ` +
        `falling back to empty list`,
      error,
    );
    return [];
  }
}
