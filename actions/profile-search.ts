"use server";
import { sql, and, eq, or, ilike, ne, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { profiles, boards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

// Returns up to 8 mentionable profiles for the @-popover.  Scope:
// board_members of the given board + workspace_members of the board's
// workspace.  Filtered by `prefix` against handle and display_name
// (case-insensitive).  RLS already constrains `profiles` to those the
// caller can see.
export async function searchMentionables(
  boardId: string,
  prefix: string,
): Promise<{ id: string; handle: string; displayName: string }[]> {
  await requireUser();
  const token = (await getSessionToken())!;
  const me = decodeSub(token);
  const q = prefix.trim().toLowerCase();
  return dbAsUser(token, async (tx) => {
    // Resolve workspace_id for the board.
    const [b] = await tx
      .select({ workspaceId: boards.workspaceId })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (!b) return [];

    // Two parallel sources, dedup on id, exclude self.
    const candidateIds = await tx
      .selectDistinct({ id: sql<string>`id` })
      .from(
        sql`(
          select user_id as id from public.board_members where board_id = ${boardId}
          union
          select user_id as id from public.workspace_members where workspace_id = ${b.workspaceId}
        ) as ids`,
      );
    const ids = candidateIds.map((r) => r.id).filter((id) => id !== me);
    if (ids.length === 0) return [];

    const where = q
      ? and(
          inArray(profiles.id, ids),
          or(
            ilike(profiles.handle, `${q}%`),
            ilike(profiles.displayName, `%${q}%`),
          ),
          ne(profiles.id, me),
        )
      : and(inArray(profiles.id, ids), ne(profiles.id, me));

    const rows = await tx
      .select({
        id: profiles.id,
        handle: profiles.handle,
        displayName: profiles.displayName,
      })
      .from(profiles)
      .where(where)
      .limit(8);
    return rows;
  });
}

// Search profiles visible to the caller by display name or handle prefix.
// Past collaborators (any user who shares a workspace_members or
// board_members row with the caller) are ranked first; everyone else
// follows alphabetically by display name.
export async function searchProfiles(
  query: string,
): Promise<{ id: string; handle: string | null; displayName: string }[]> {
  await requireUser();
  const token = (await getSessionToken())!;
  const me = decodeSub(token);
  const q = query.trim().toLowerCase();
  return dbAsUser(token, async (tx) => {
    // Collaborators: anyone who has been on any of the caller's
    // workspaces or boards. Dedup by id, exclude self.
    const collabRows = await tx
      .selectDistinct({ id: sql<string>`id` })
      .from(
        sql`(
          select wm2.user_id as id
            from public.workspace_members wm1
            join public.workspace_members wm2 on wm2.workspace_id = wm1.workspace_id
            where wm1.user_id = ${me} and wm2.user_id <> ${me}
          union
          select bm2.user_id as id
            from public.board_members bm1
            join public.board_members bm2 on bm2.board_id = bm1.board_id
            where bm1.user_id = ${me} and bm2.user_id <> ${me}
        ) as collab`,
      );
    const collabSet = new Set(collabRows.map((r) => r.id));

    const where = q
      ? or(
          ilike(profiles.handle, `${q}%`),
          ilike(profiles.displayName, `%${q}%`),
        )
      : undefined;
    const rows = await tx
      .select({
        id: profiles.id,
        handle: profiles.handle,
        displayName: profiles.displayName,
      })
      .from(profiles)
      .where(where)
      .limit(48);

    // Hide seed-generated profiles (handle ending in a long timestamp,
    // e.g. "agg-nav-1778140694228-296208") from the empty-query preload.
    // Once the user types something, surface every match.
    const seedPattern = /-\d{10,}(-[a-z0-9]+)?$/i;
    const filtered = q
      ? rows
      : rows.filter((r) => !seedPattern.test(r.handle ?? ""));

    // Sort: caller-self last (or absent if RLS doesn't return it),
    // collaborators first, then alphabetical by display name.
    filtered.sort((a, b) => {
      if (a.id === me && b.id !== me) return 1;
      if (b.id === me && a.id !== me) return -1;
      const aCollab = collabSet.has(a.id) ? 0 : 1;
      const bCollab = collabSet.has(b.id) ? 0 : 1;
      if (aCollab !== bCollab) return aCollab - bCollab;
      return a.displayName.localeCompare(b.displayName);
    });

    return filtered.slice(0, 12);
  });
}
