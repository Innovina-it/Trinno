import { eq, and, isNotNull, desc, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards, cardSprintHistory } from "@/lib/db/schema";

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
        completedAt: cards.completedAt,
      })
      .from(cards)
      .where(and(eq(cards.sprintId, sprintId), isNotNull(cards.storyPoints)));

    const total = sprintCards.reduce((s, c) => s + (c.storyPoints ?? 0), 0);

    // Single source of truth: cards.completed_at (kept in sync with
    // cards.due_complete by the DB trigger from migration 0062). The
    // previous implementation walked card.archive activity rows, which
    // conflated "removed from view" with "completed".
    const completedAtById = new Map<string, Date>();
    for (const c of sprintCards) {
      if (c.completedAt) completedAtById.set(c.id, c.completedAt);
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
        const at = completedAtById.get(id);
        if (at && at <= new Date(d.getTime() + 86_400_000 - 1)) {
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
      // Velocity uses cards.completed_at (migration 0062), not cards.archived,
      // since archive == "removed from view" not "completed". A card counts
      // toward this sprint's velocity iff:
      //   - some card_sprint_history row places the card on THIS sprint
      //     across an interval that contains `completed_at` (migration
      //     0089 — replaces the old "current cards.sprint_id" reading
      //     so cards moved between sprints are attributed to whichever
      //     sprint they were IN at completion time),
      //   - it has story points,
      //   - completed_at is set, AND
      //   - completed_at also falls inside the sprint window
      //     [start_date, completed_at ?? end_date].
      // Backfill (0089) seeds one row per assigned card, but if any
      // gap exists (history empty for a sprint that has cards) we fall
      // back to the legacy `cards.sprintId` reading to avoid silently
      // zeroing out historical velocity.
      const history = await tx
        .select({
          cardId: cardSprintHistory.cardId,
          assignedAt: cardSprintHistory.assignedAt,
          removedAt: cardSprintHistory.removedAt,
        })
        .from(cardSprintHistory)
        .where(eq(cardSprintHistory.sprintId, sp.id));

      let sprintCards: Array<{
        id: string;
        storyPoints: number | null;
        completedAt: Date | null;
      }>;

      if (history.length === 0) {
        sprintCards = await tx
          .select({
            id: cards.id,
            storyPoints: cards.storyPoints,
            completedAt: cards.completedAt,
          })
          .from(cards)
          .where(
            and(
              eq(cards.sprintId, sp.id),
              isNotNull(cards.storyPoints),
              isNotNull(cards.completedAt),
            ),
          );
      } else {
        const cardIds = Array.from(new Set(history.map((h) => h.cardId)));
        const cardRows = await tx
          .select({
            id: cards.id,
            storyPoints: cards.storyPoints,
            completedAt: cards.completedAt,
          })
          .from(cards)
          .where(
            and(
              inArray(cards.id, cardIds),
              isNotNull(cards.storyPoints),
              isNotNull(cards.completedAt),
            ),
          );

        // Keep only cards whose `completed_at` lies inside SOME open
        // window for THIS sprint. A card may have multiple history
        // rows on the same sprint (assigned → removed → re-assigned);
        // any one match is enough.
        const historyByCard = new Map<
          string,
          Array<{ assignedAt: Date; removedAt: Date | null }>
        >();
        for (const h of history) {
          const arr = historyByCard.get(h.cardId) ?? [];
          arr.push({
            assignedAt: h.assignedAt instanceof Date ? h.assignedAt : new Date(h.assignedAt),
            removedAt: h.removedAt
              ? h.removedAt instanceof Date
                ? h.removedAt
                : new Date(h.removedAt)
              : null,
          });
          historyByCard.set(h.cardId, arr);
        }
        sprintCards = cardRows.filter((c) => {
          if (!c.completedAt) return false;
          const at = c.completedAt instanceof Date ? c.completedAt : new Date(c.completedAt);
          const windows = historyByCard.get(c.id) ?? [];
          return windows.some(
            (w) => at >= w.assignedAt && (w.removedAt === null || at < w.removedAt),
          );
        });
      }

      const windowStart = sp.startDate ?? sp.createdAt ?? null;
      const windowEnd = sp.completedAt ?? sp.endDate ?? null;
      const completed = sprintCards.reduce((s, c) => {
        if (!c.completedAt) return s;
        const at = c.completedAt instanceof Date ? c.completedAt : new Date(c.completedAt);
        if (windowStart && at < windowStart) return s;
        if (windowEnd && at > windowEnd) return s;
        return s + (c.storyPoints ?? 0);
      }, 0);

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
