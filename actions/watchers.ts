"use server";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cardWatchers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { WatchCardInput, UnwatchCardInput } from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    .sub as string;
}

export async function watchCardImpl(token: string, input: { cardId: string }) {
  const p = WatchCardInput.parse(input);
  const uid = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await tx
      .insert(cardWatchers)
      .values({
        cardId: p.cardId,
        userId: uid,
        boardId: "00000000-0000-0000-0000-000000000000",
        auto: false,
      })
      .onConflictDoNothing();
  });
}

export async function unwatchCardImpl(
  token: string,
  input: { cardId: string },
) {
  const p = UnwatchCardInput.parse(input);
  const uid = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    await tx
      .delete(cardWatchers)
      .where(
        and(eq(cardWatchers.cardId, p.cardId), eq(cardWatchers.userId, uid)),
      );
  });
}

export async function watchCard(input: { cardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await watchCardImpl(t, input);
}

export async function unwatchCard(input: { cardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await unwatchCardImpl(t, input);
}
