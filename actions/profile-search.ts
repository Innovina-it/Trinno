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
