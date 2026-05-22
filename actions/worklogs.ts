"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { worklogs } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import { LogWorkInput, DeleteWorklogInput } from "@/lib/validation";
import { StructuredError } from "@/lib/errors";

function decodeSub(jwt: string) {
  const [, p] = jwt.split(".");
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8")).sub as string;
}

export async function logWorkImpl(
  token: string,
  input: {
    cardId: string;
    minutes: number;
    startedAt?: string | Date | null;
    comment?: string | null;
  },
) {
  const p = LogWorkInput.parse(input);
  const userId = decodeSub(token);
  const startedAt = p.startedAt
    ? p.startedAt instanceof Date
      ? p.startedAt
      : new Date(p.startedAt)
    : new Date();
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .insert(worklogs)
      .values({
        cardId: p.cardId,
        boardId: "00000000-0000-0000-0000-000000000000",
        userId,
        minutes: p.minutes,
        startedAt,
        comment: p.comment ?? null,
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function deleteWorklogImpl(token: string, input: { id: string }) {
  const p = DeleteWorklogInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(worklogs)
      .where(eq(worklogs.id, p.id))
      .returning({ id: worklogs.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  });
}

export async function logWork(input: Parameters<typeof logWorkImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await logWorkImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function deleteWorklog(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteWorklogImpl(t, input);
}
