"use server";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateCommentInput, EditCommentInput, DeleteCommentInput,
} from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createCommentImpl(token: string, input: { cardId: string; body: string }) {
  const parsed = CreateCommentInput.parse(input);
  const authorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.insert(comments).values({
      cardId: parsed.cardId,
      authorId,
      body: parsed.body,
      boardId: "00000000-0000-0000-0000-000000000000",
    }).returning();
    if (!row) throw new Error("Forbidden");
    // The before-insert trigger overwrites `board_id` with the card's
    // real board, but `RETURNING` reflects the pre-trigger value (the
    // sentinel UUID).  Re-read the row so callers — and
    // `revalidatePath(/b/<boardId>)` in the wrapper below — see the
    // actual board the comment belongs to.
    const [fresh] = await tx
      .select()
      .from(comments)
      .where(eq(comments.id, row.id))
      .limit(1);
    return fresh ?? row;
  });
}

export async function editCommentImpl(token: string, input: { id: string; body: string }) {
  const parsed = EditCommentInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx.update(comments)
      .set({ body: parsed.body, editedAt: sql`now()` })
      .where(eq(comments.id, parsed.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteCommentImpl(token: string, input: { id: string }) {
  const parsed = DeleteCommentInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(comments).where(eq(comments.id, parsed.id))
      .returning({ id: comments.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function createComment(input: Parameters<typeof createCommentImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createCommentImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function editComment(input: Parameters<typeof editCommentImpl>[1]) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await editCommentImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function deleteComment(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteCommentImpl(t, input);
}
