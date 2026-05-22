"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cardLinks } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { CreateCardLinkInput, DeleteCardLinkInput } from "@/lib/validation";
import { StructuredError, actionResult } from "@/lib/errors";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createCardLinkImpl(
  token: string,
  input: {
    fromCardId: string;
    toCardId: string;
    kind:
      | "blocks"
      | "is_blocked_by"
      | "relates_to"
      | "duplicates"
      | "is_duplicated_by";
  },
) {
  const parsed = CreateCardLinkInput.parse(input);
  if (parsed.fromCardId === parsed.toCardId)
    throw new StructuredError(
      "VALIDATION_ERROR",
      "Cannot link card to itself",
      { kind: "self-link" },
    );
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .insert(cardLinks)
      .values({
        fromCardId: parsed.fromCardId,
        toCardId: parsed.toCardId,
        kind: parsed.kind,
        boardId: "00000000-0000-0000-0000-000000000000", // overwritten by trigger
        createdBy,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function deleteCardLinkImpl(token: string, input: { id: string }) {
  const parsed = DeleteCardLinkInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(cardLinks)
      .where(eq(cardLinks.id, parsed.id))
      .returning({ id: cardLinks.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  });
}

// Wrappers
export async function createCardLink(
  input: Parameters<typeof createCardLinkImpl>[1],
) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await createCardLinkImpl(t, input);
    revalidatePath(`/b/${r.boardId}`);
    return r;
  });
}

export async function deleteCardLink(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteCardLinkImpl(t, input);
}
