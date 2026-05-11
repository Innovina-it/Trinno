import { eq, sql, inArray } from "drizzle-orm";
import { sprints, workspaces } from "@/lib/db/schema";
import { dbAsUser, meId } from "@/lib/queries/me";

export type MyActiveSprint = {
  id: string;
  name: string;
  goal: string | null;
  startDate: Date | null;
  endDate: Date | null;
  workspaceId: string;
  workspaceName: string;
  myCardCount: number;
  myPoints: number;
  myCompletedPoints: number;
  totalCardCount: number;
  totalPoints: number;
  totalCompletedPoints: number;
};

/**
 * Active sprints across every workspace the user can see (RLS).
 * Returns one row per sprint regardless of membership. archived=false. Limit 20.
 */
export async function listMyActiveSprints(
  token: string,
): Promise<MyActiveSprint[]> {
  const userId = await meId(token);

  return dbAsUser(token, async (tx) => {
    // 1. Fetch all active sprints (RLS scopes to workspaces user can see).
    const activeSprints = await tx
      .select({
        id: sprints.id,
        name: sprints.name,
        goal: sprints.goal,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
        workspaceId: sprints.workspaceId,
      })
      .from(sprints)
      .where(eq(sprints.state, "active"))
      .limit(20);

    if (activeSprints.length === 0) return [];

    // 2. Fetch workspace names for the sprints found.
    const workspaceIds = [...new Set(activeSprints.map((s) => s.workspaceId))];
    const wsRows = await tx
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(inArray(workspaces.id, workspaceIds));
    const wsNameById = new Map(wsRows.map((w) => [w.id, w.name]));

    const sprintIds = activeSprints.map((s) => s.id);

    // 3. Aggregate card stats in one query.
    //    "my card" = owner OR member. Avoid counting the same card twice via DISTINCT.
    //    We compute both total stats and my-card stats in one pass using CASE WHEN.
    const statsRows = await tx.execute(sql`
      WITH my_card_ids AS (
        SELECT DISTINCT c.id AS card_id, c.sprint_id
        FROM cards c
        LEFT JOIN card_members cm ON cm.card_id = c.id
        WHERE c.sprint_id = ANY(${sql.raw(`ARRAY[${sprintIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})
          AND c.archived = false
          AND (c.owner_id = ${userId}::uuid OR cm.user_id = ${userId}::uuid)
      ),
      totals AS (
        SELECT
          c.sprint_id,
          COUNT(*)                                               AS total_card_count,
          COALESCE(SUM(c.story_points), 0)                      AS total_points,
          COALESCE(SUM(CASE WHEN c.completed_at IS NOT NULL THEN c.story_points ELSE 0 END), 0) AS total_completed_points
        FROM cards c
        WHERE c.sprint_id = ANY(${sql.raw(`ARRAY[${sprintIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})
          AND c.archived = false
        GROUP BY c.sprint_id
      ),
      mine AS (
        SELECT
          mc.sprint_id,
          COUNT(*)                                               AS my_card_count,
          COALESCE(SUM(c.story_points), 0)                      AS my_points,
          COALESCE(SUM(CASE WHEN c.completed_at IS NOT NULL THEN c.story_points ELSE 0 END), 0) AS my_completed_points
        FROM my_card_ids mc
        JOIN cards c ON c.id = mc.card_id
        GROUP BY mc.sprint_id
      )
      SELECT
        t.sprint_id,
        t.total_card_count,
        t.total_points,
        t.total_completed_points,
        COALESCE(m.my_card_count, 0)       AS my_card_count,
        COALESCE(m.my_points, 0)           AS my_points,
        COALESCE(m.my_completed_points, 0) AS my_completed_points
      FROM totals t
      LEFT JOIN mine m ON m.sprint_id = t.sprint_id
    `);

    type StatsRow = {
      sprint_id: string;
      total_card_count: string | number;
      total_points: string | number;
      total_completed_points: string | number;
      my_card_count: string | number;
      my_points: string | number;
      my_completed_points: string | number;
    };

    const statsBySprint = new Map<string, StatsRow>(
      (statsRows as unknown as StatsRow[]).map((r) => [r.sprint_id, r]),
    );

    return activeSprints.map((s) => {
      const st = statsBySprint.get(s.id);
      const num = (v: string | number | undefined) => Number(v ?? 0);
      return {
        id: s.id,
        name: s.name,
        goal: s.goal,
        startDate: s.startDate,
        endDate: s.endDate,
        workspaceId: s.workspaceId,
        workspaceName: wsNameById.get(s.workspaceId) ?? "",
        myCardCount: num(st?.my_card_count),
        myPoints: num(st?.my_points),
        myCompletedPoints: num(st?.my_completed_points),
        totalCardCount: num(st?.total_card_count),
        totalPoints: num(st?.total_points),
        totalCompletedPoints: num(st?.total_completed_points),
      };
    });
  });
}
