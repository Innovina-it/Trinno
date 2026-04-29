import { eq, desc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { activity, profiles } from "@/lib/db/schema";

export async function listActivityForBoard(
  token: string,
  boardId: string,
  limit = 50,
) {
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        id: activity.id,
        type: activity.type,
        payload: activity.payload,
        cardId: activity.cardId,
        actorId: activity.actorId,
        createdAt: activity.createdAt,
        actorName: profiles.displayName,
      })
      .from(activity)
      .leftJoin(profiles, eq(profiles.id, activity.actorId))
      .where(eq(activity.boardId, boardId))
      .orderBy(desc(activity.createdAt))
      .limit(limit),
  );
}

export async function listActivityForCard(
  token: string,
  cardId: string,
  limit = 50,
) {
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        id: activity.id,
        type: activity.type,
        payload: activity.payload,
        actorId: activity.actorId,
        createdAt: activity.createdAt,
        actorName: profiles.displayName,
      })
      .from(activity)
      .leftJoin(profiles, eq(profiles.id, activity.actorId))
      .where(eq(activity.cardId, cardId))
      .orderBy(desc(activity.createdAt))
      .limit(limit),
  );
}
