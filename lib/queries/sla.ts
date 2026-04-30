import { eq, and, isNull } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { slaPolicies, cardSla } from "@/lib/db/schema";

export async function listSlaPoliciesForBoard(token: string, boardId: string) {
  return dbAsUser(token, async (tx) =>
    tx.select().from(slaPolicies).where(eq(slaPolicies.boardId, boardId)),
  );
}

export async function listBreachedCards(token: string, boardId: string) {
  return dbAsUser(token, async (tx) =>
    tx
      .select()
      .from(cardSla)
      .where(and(eq(cardSla.boardId, boardId), isNull(cardSla.resolvedAt))),
  );
}
