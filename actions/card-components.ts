"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cardComponents } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { ToggleCardComponentInput } from "@/lib/validation";
import { StructuredError } from "@/lib/errors";
import {
  assertNotGuest,
  getWorkspaceRoleForCard,
} from "@/lib/permissions/guest-guard";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

const PLACEHOLDER_BOARD_ID = "00000000-0000-0000-0000-000000000000";

export async function toggleCardComponentImpl(
  token: string,
  input: { cardId: string; componentId: string },
) {
  const p = ToggleCardComponentInput.parse(input);
  const actorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertNotGuest(await getWorkspaceRoleForCard(tx, p.cardId, actorId));
    const existing = await tx
      .select()
      .from(cardComponents)
      .where(
        and(
          eq(cardComponents.cardId, p.cardId),
          eq(cardComponents.componentId, p.componentId),
        ),
      );
    if (existing.length > 0) {
      await tx
        .delete(cardComponents)
        .where(
          and(
            eq(cardComponents.cardId, p.cardId),
            eq(cardComponents.componentId, p.componentId),
          ),
        );
      return { attached: false };
    }
    // boardId set by trigger.
    const [row] = await tx
      .insert(cardComponents)
      .values({
        cardId: p.cardId,
        componentId: p.componentId,
        boardId: PLACEHOLDER_BOARD_ID,
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return { attached: true, boardId: row.boardId };
  });
}

export async function toggleCardComponent(input: {
  cardId: string;
  componentId: string;
}) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await toggleCardComponentImpl(t, input);
  if (r.attached && "boardId" in r && r.boardId)
    revalidatePath(`/b/${r.boardId}`);
  return r;
}
