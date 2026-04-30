import { eq, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { components } from "@/lib/db/schema";

export async function listComponents(token: string, boardId: string) {
  return dbAsUser(token, async (tx) =>
    tx
      .select()
      .from(components)
      .where(eq(components.boardId, boardId))
      .orderBy(asc(components.name)),
  );
}
