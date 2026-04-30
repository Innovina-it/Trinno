import { eq, and, isNotNull, inArray, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards, activity } from "@/lib/db/schema";

export type BurndownPoint = {
  day: string;
  pointsRemaining: number;
  idealRemaining: number;
  pointsCompleted: number;
};

export async function computeBurndown(
  token: string,
  sprintId: string,
): Promise<{
  total: number;
  points: BurndownPoint[];
  sprint: typeof sprints.$inferSelect | null;
}> {
  return dbAsUser(token, async (tx) => {
    const [sp] = await tx.select().from(sprints).where(eq(sprints.id, sprintId));
    if (!sp) return { total: 0, points: [], sprint: null };

    const start = sp.startDate ?? sp.createdAt ?? new Date();
    const end = sp.completedAt ?? sp.endDate ?? new Date();

    const startD = new Date(start); startD.setUTCHours(0, 0, 0, 0);
    const endD = new Date(end); endD.setUTCHours(0, 0, 0, 0);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);

    const sprintCards = await tx
      .select({
        id: cards.id,
        storyPoints: cards.storyPoints,
      })
      .from(cards)
      .where(and(eq(cards.sprintId, sprintId), isNotNull(cards.storyPoints)));

    const total = sprintCards.reduce((s, c) => s + (c.storyPoints ?? 0), 0);
    const cardIds = sprintCards.map((c) => c.id);

    // Map cardId -> most recent 'card.archive' timestamp.
    const archivedMap = new Map<string, Date>();
    if (cardIds.length > 0) {
      const acts = await tx
        .select({
          cardId: activity.cardId,
          createdAt: activity.createdAt,
          type: activity.type,
        })
        .from(activity)
        .where(inArray(activity.cardId, cardIds))
        .orderBy(desc(activity.createdAt));

      for (const a of acts) {
        if (!a.cardId) continue;
        if (archivedMap.has(a.cardId)) continue;
        if (a.type === "card.archive") {
          archivedMap.set(a.cardId, new Date(a.createdAt as unknown as string));
        } else if (a.type === "card.unarchive") {
          // explicit unarchive after archive — record sentinel so we skip
          archivedMap.set(a.cardId, new Date(0));
        }
      }
    }

    const ptsByCard = new Map(sprintCards.map((c) => [c.id, c.storyPoints ?? 0]));

    const days: Date[] = [];
    {
      const cur = new Date(startD);
      while (cur <= endD) {
        days.push(new Date(cur));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    const dayCount = days.length;
    const points: BurndownPoint[] = days.map((d, idx) => {
      let completed = 0;
      for (const [id, pts] of ptsByCard) {
        const at = archivedMap.get(id);
        if (at && at.getTime() > 0 && at <= new Date(d.getTime() + 86_400_000 - 1)) {
          completed += pts;
        }
      }
      const remaining = total - completed;
      const ideal = dayCount <= 1 ? 0 : total - (total * idx) / (dayCount - 1);
      return {
        day: d.toISOString().slice(0, 10),
        pointsRemaining: remaining,
        pointsCompleted: completed,
        idealRemaining: ideal,
      };
    });

    return { total, points, sprint: sp };
  });
}

export async function computeVelocity(
  token: string,
  workspaceId: string,
  n = 6,
): Promise<
  Array<{
    sprintId: string;
    name: string;
    pointsCompleted: number;
    completedAt: Date | null;
  }>
> {
  return dbAsUser(token, async (tx) => {
    const completedSprints = await tx
      .select()
      .from(sprints)
      .where(
        and(
          eq(sprints.workspaceId, workspaceId),
          eq(sprints.state, "completed"),
        ),
      )
      .orderBy(desc(sprints.completedAt))
      .limit(n);

    if (completedSprints.length === 0) return [];

    const out: Array<{
      sprintId: string;
      name: string;
      pointsCompleted: number;
      completedAt: Date | null;
    }> = [];
    for (const sp of completedSprints.reverse()) {
      const sprintCards = await tx
        .select({
          id: cards.id,
          storyPoints: cards.storyPoints,
          archived: cards.archived,
        })
        .from(cards)
        .where(
          and(eq(cards.sprintId, sp.id), isNotNull(cards.storyPoints)),
        );

      const completed = sprintCards
        .filter((c) => c.archived)
        .reduce((s, c) => s + (c.storyPoints ?? 0), 0);

      out.push({
        sprintId: sp.id,
        name: sp.name,
        pointsCompleted: completed,
        completedAt: sp.completedAt as Date | null,
      });
    }
    return out;
  });
}
