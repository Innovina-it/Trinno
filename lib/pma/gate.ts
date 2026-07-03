import "server-only";

import { and, eq } from "drizzle-orm";

import { dbAsUser } from "@/lib/db/client";
import { links } from "@/lib/db/schema";
import { getWorkspaceRole } from "@/lib/permissions/guest-guard";
import { extractDriveFileId } from "./detect";

// PMA U10 — Analysis-tab run gate. Decides whether the "Run analysis" button is
// enabled for the viewer: owner/admin AND both Drive folders configured (the
// route enforces the same, this just drives the UI affordance + reason). Read as
// the acting user so RLS scopes the role + link lookups.

export type AnalysisGate = {
  isOwner: boolean;
  isOwnerAdmin: boolean;
  foldersConfigured: boolean;
  canRun: boolean;
};

export async function getAnalysisGate(
  token: string,
  workspaceId: string,
  userId: string,
): Promise<AnalysisGate> {
  return dbAsUser(token, async (tx) => {
    const role = await getWorkspaceRole(tx, workspaceId, userId);
    const isOwnerAdmin = role === "owner" || role === "admin";

    const wsLinks = await tx
      .select({ url: links.url, purpose: links.purpose })
      .from(links)
      .where(and(eq(links.workspaceId, workspaceId), eq(links.scope, "workspace")));
    const sourceUrl = wsLinks.find((l) => l.purpose === "source")?.url ?? null;
    const reportsUrl = wsLinks.find((l) => l.purpose === "reports")?.url ?? null;
    const foldersConfigured =
      !!(sourceUrl && extractDriveFileId(sourceUrl)) &&
      !!(reportsUrl && extractDriveFileId(reportsUrl));

    return {
      isOwner: role === "owner",
      isOwnerAdmin,
      foldersConfigured,
      canRun: isOwnerAdmin && foldersConfigured,
    };
  });
}
