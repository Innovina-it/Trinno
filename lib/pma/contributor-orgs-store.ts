import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { pmaContributorOrgs } from "@/lib/db/schema";
import type { ContributorOrgEntry } from "./contributor-orgs";

// PMA — contributor → organization map: Postgres CRUD (migration 0142).
//
// Writes are gated to owner/admin by RLS (the policy in 0142), so these run
// under the caller's JWT via dbAsUser — a member's write simply affects zero
// rows. The server actions (actions/pma-orgs.ts) add a friendly role check on
// top; run.ts uses listContributorOrgs (read) to feed the synthesis resolver.

export type ContributorOrgRow = ContributorOrgEntry & {
  id: string;
  displayName: string | null;
};

export async function listContributorOrgs(
  token: string,
  workspaceId: string,
): Promise<ContributorOrgRow[]> {
  const rows = await dbAsUser(token, async (tx) =>
    tx
      .select({
        id: pmaContributorOrgs.id,
        identityKind: pmaContributorOrgs.identityKind,
        identityKey: pmaContributorOrgs.identityKey,
        displayName: pmaContributorOrgs.displayName,
        org: pmaContributorOrgs.org,
      })
      .from(pmaContributorOrgs)
      .where(eq(pmaContributorOrgs.workspaceId, workspaceId))
      .orderBy(asc(pmaContributorOrgs.org), asc(pmaContributorOrgs.identityKey)),
  );
  return rows.map((r) => ({
    id: r.id,
    identityKind: r.identityKind === "email" ? "email" : "name",
    identityKey: r.identityKey,
    displayName: r.displayName,
    org: r.org,
  }));
}

export type UpsertContributorOrgInput = {
  workspaceId: string;
  identityKind: "email" | "name";
  identityKey: string;
  displayName?: string | null;
  org: string;
};

// Upsert by the (workspace, kind, key) unique constraint. Emails are normalised
// to lowercase so the key matches the resolver's lookup; names are trimmed.
export async function upsertContributorOrg(
  token: string,
  input: UpsertContributorOrgInput,
): Promise<void> {
  const key =
    input.identityKind === "email"
      ? input.identityKey.trim().toLowerCase()
      : input.identityKey.trim();
  const org = input.org.trim();
  await dbAsUser(token, async (tx) =>
    tx
      .insert(pmaContributorOrgs)
      .values({
        workspaceId: input.workspaceId,
        identityKind: input.identityKind,
        identityKey: key,
        displayName: input.displayName?.trim() || null,
        org,
      })
      .onConflictDoUpdate({
        target: [
          pmaContributorOrgs.workspaceId,
          pmaContributorOrgs.identityKind,
          pmaContributorOrgs.identityKey,
        ],
        // updated_at is bumped by the SQL trigger; no need to set it here.
        set: { org, displayName: input.displayName?.trim() || null },
      }),
  );
}

export async function deleteContributorOrg(
  token: string,
  workspaceId: string,
  id: string,
): Promise<void> {
  await dbAsUser(token, async (tx) =>
    tx
      .delete(pmaContributorOrgs)
      .where(
        and(
          eq(pmaContributorOrgs.workspaceId, workspaceId),
          eq(pmaContributorOrgs.id, id),
        ),
      ),
  );
}
