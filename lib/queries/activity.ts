import { eq, desc, inArray } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { activity, profiles, cards } from "@/lib/db/schema";

export async function listActivityForBoard(
  token: string,
  boardId: string,
  limit = 50,
) {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        id: activity.id,
        type: activity.type,
        payload: activity.payload,
        cardId: activity.cardId,
        actorId: activity.actorId,
        createdAt: activity.createdAt,
        actorName: profiles.displayName,
        cardTitle: cards.title,
      })
      .from(activity)
      .leftJoin(profiles, eq(profiles.id, activity.actorId))
      .leftJoin(cards, eq(cards.id, activity.cardId))
      .where(eq(activity.boardId, boardId))
      .orderBy(desc(activity.createdAt))
      .limit(limit);

    // Some events (board.member.add / .remove, card.member.assign /
    // .unassign) carry a *target* user id in the payload alongside the
    // actor.  Resolve those to display names in one batch round-trip
    // so the feed can render "Ali added Bob" instead of just
    // "Ali joined".
    const targetIds = new Set<string>();
    for (const r of rows) {
      const p = r.payload as Record<string, unknown> | null;
      const uid = p && typeof p["user_id"] === "string" ? (p["user_id"] as string) : null;
      if (uid) targetIds.add(uid);
    }
    let targets = new Map<string, string>();
    if (targetIds.size > 0) {
      const profileRows = await tx
        .select({ id: profiles.id, displayName: profiles.displayName })
        .from(profiles)
        .where(inArray(profiles.id, [...targetIds]));
      targets = new Map(profileRows.map((p) => [p.id, p.displayName]));
    }
    return rows.map((r) => {
      const p = r.payload as Record<string, unknown> | null;
      const uid = p && typeof p["user_id"] === "string" ? (p["user_id"] as string) : null;
      return { ...r, targetName: uid ? targets.get(uid) ?? null : null };
    });
  });
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
