import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards } from "@/lib/db/schema";

export async function getBoard(token: string, id: string) {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.select().from(boards).where(eq(boards.id, id));
    return row ?? null;
  });
}
