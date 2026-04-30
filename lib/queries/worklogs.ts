import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { worklogs, profiles } from "@/lib/db/schema";

export async function listWorklogsForCard(token: string, cardId: string) {
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        id: worklogs.id,
        minutes: worklogs.minutes,
        startedAt: worklogs.startedAt,
        comment: worklogs.comment,
        userId: worklogs.userId,
        userName: profiles.displayName,
        createdAt: worklogs.createdAt,
      })
      .from(worklogs)
      .leftJoin(profiles, eq(profiles.id, worklogs.userId))
      .where(eq(worklogs.cardId, cardId))
      .orderBy(desc(worklogs.startedAt)),
  );
}
