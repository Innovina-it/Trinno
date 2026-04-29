"use server";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cardMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { ToggleCardMemberInput } from "@/lib/validation";

export async function toggleCardMemberImpl(token: string, input: { cardId: string; userId: string }) {
  const parsed = ToggleCardMemberInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const existing = await tx.select().from(cardMembers).where(and(
      eq(cardMembers.cardId, parsed.cardId),
      eq(cardMembers.userId, parsed.userId),
    ));
    if (existing.length > 0) {
      await tx.delete(cardMembers).where(and(
        eq(cardMembers.cardId, parsed.cardId),
        eq(cardMembers.userId, parsed.userId),
      ));
      return { assigned: false };
    }
    // boardId set by trigger
    const [row] = await tx.insert(cardMembers).values({
      cardId: parsed.cardId, userId: parsed.userId,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new Error("Forbidden");
    return { assigned: true };
  });
}

export async function toggleCardMember(input: { cardId: string; userId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  return toggleCardMemberImpl(t, input);
}
