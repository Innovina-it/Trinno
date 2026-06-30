"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspaceRole } from "@/lib/queries/workspaces";
import { dbAsUser } from "@/lib/db/client";
import { links } from "@/lib/db/schema";
import {
  listContributorOrgs,
  upsertContributorOrg,
  deleteContributorOrg,
  type ContributorOrgRow,
} from "@/lib/pma/contributor-orgs-store";
import { isServiceAccountEmail } from "@/lib/pma/contributor-orgs";
import { extractDriveFileId } from "@/lib/pma/detect";
import { listFolderTree } from "@/lib/pma/clients/drive";

// Server actions for the per-workspace contributor → organization map, used by
// the "Organizations" section of workspace Settings. Reads are open to members
// (RLS allows member SELECT); writes and the live scan are owner/admin only,
// checked here for a friendly error and enforced again by RLS as the backstop.

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const msg = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

async function requireAdmin(workspaceId: string) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const role = await getWorkspaceRole(token, workspaceId, user.id);
  const isAdmin = role === "owner" || role === "admin";
  return { token, isAdmin };
}

export async function listContributorOrgsAction(
  workspaceId: string,
): Promise<Result<{ rows: ContributorOrgRow[] }>> {
  await requireUser();
  const token = (await getSessionToken())!;
  try {
    return { ok: true, rows: await listContributorOrgs(token, workspaceId) };
  } catch (e) {
    return { ok: false, error: msg(e, "Failed to load organizations.") };
  }
}

export async function upsertContributorOrgAction(input: {
  workspaceId: string;
  identityKind: "email" | "name";
  identityKey: string;
  displayName?: string | null;
  org: string;
}): Promise<Result> {
  const { token, isAdmin } = await requireAdmin(input.workspaceId);
  if (!isAdmin)
    return { ok: false, error: "Only an owner or admin can edit organizations." };
  const identityKey = input.identityKey.trim();
  const org = input.org.trim();
  if (!identityKey) return { ok: false, error: "Contributor is required." };
  if (!org) return { ok: false, error: "Organization is required." };
  try {
    await upsertContributorOrg(token, { ...input, identityKey, org });
    revalidatePath(`/w/${input.workspaceId}/settings`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Save failed.") };
  }
}

export async function deleteContributorOrgAction(input: {
  workspaceId: string;
  id: string;
}): Promise<Result> {
  const { token, isAdmin } = await requireAdmin(input.workspaceId);
  if (!isAdmin)
    return { ok: false, error: "Only an owner or admin can edit organizations." };
  try {
    await deleteContributorOrg(token, input.workspaceId, input.id);
    revalidatePath(`/w/${input.workspaceId}/settings`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Delete failed.") };
  }
}

export type ScannedContributor = { name: string | null; email: string | null };

// Live "scan contributors": read the workspace's source (Documents) folder and
// return the distinct editors Drive exposes (the last modifier of each file), so
// the settings table can offer real names+emails to assign instead of guessing.
// Read-only — never writes Drive. Skips the Reports/Context folders, like detect.
export async function scanContributorsAction(
  workspaceId: string,
): Promise<Result<{ contributors: ScannedContributor[] }>> {
  const { token, isAdmin } = await requireAdmin(workspaceId);
  if (!isAdmin)
    return { ok: false, error: "Only an owner or admin can scan contributors." };

  const sourceUrl = await dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({ url: links.url, purpose: links.purpose })
      .from(links)
      .where(and(eq(links.workspaceId, workspaceId), eq(links.scope, "workspace")));
    return rows.find((r) => r.purpose === "source")?.url ?? null;
  }).catch(() => null);
  const sourceFolderId = sourceUrl ? extractDriveFileId(sourceUrl) : null;
  if (!sourceFolderId)
    return {
      ok: false,
      error: "No analysis source folder is configured for this workspace.",
    };

  try {
    const files = await listFolderTree(sourceFolderId, {
      skipNames: ["Reports", "Context"],
    });
    const seen = new Set<string>();
    const contributors: ScannedContributor[] = [];
    for (const f of files) {
      const name = f.lastModifiedBy;
      const email = f.lastModifiedByEmail;
      if (!name && !email) continue;
      // Drop the doc-generator service account — it's a bot, not a contributor.
      if (isServiceAccountEmail(email)) continue;
      const key = (email ?? name ?? "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      contributors.push({ name, email });
    }
    contributors.sort((a, b) =>
      (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""),
    );
    return { ok: true, contributors };
  } catch (e) {
    return { ok: false, error: msg(e, "Scan failed.") };
  }
}
