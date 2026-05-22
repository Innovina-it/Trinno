"use server";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateCommentInput, EditCommentInput, DeleteCommentInput,
  ResolveCommentInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

type CommentActionRow = typeof comments.$inferSelect;

function mapCommentRow(r: {
  id: string;
  card_id: string;
  board_id: string;
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: Date | string;
  edited_at: Date | string | null;
  resolved_at: Date | string | null;
  resolved_by: string | null;
}): CommentActionRow {
  return {
    id: r.id,
    cardId: r.card_id,
    boardId: r.board_id,
    authorId: r.author_id,
    parentCommentId: r.parent_comment_id ?? null,
    body: r.body,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    editedAt: r.edited_at
      ? r.edited_at instanceof Date
        ? r.edited_at
        : new Date(r.edited_at)
      : null,
    resolvedAt: r.resolved_at
      ? r.resolved_at instanceof Date
        ? r.resolved_at
        : new Date(r.resolved_at)
      : null,
    resolvedBy: r.resolved_by ?? null,
  };
}

export async function createCommentImpl(token: string, input: { cardId: string; body: string; parentCommentId?: string | null }) {
  const parsed = CreateCommentInput.parse(input);
  const authorId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    if (parsed.parentCommentId) {
      const rows = await tx.execute(sql`
        insert into public.comments (card_id, author_id, parent_comment_id, body, board_id)
        values (${parsed.cardId}, ${authorId}, ${parsed.parentCommentId}, ${parsed.body}, '00000000-0000-0000-0000-000000000000')
        returning
          id,
          card_id,
          board_id,
          author_id,
          nullif(to_jsonb(comments)->>'parent_comment_id', '')::uuid as parent_comment_id,
          body,
          created_at,
          edited_at,
          nullif(to_jsonb(comments)->>'resolved_at', '')::timestamptz as resolved_at,
          nullif(to_jsonb(comments)->>'resolved_by', '')::uuid as resolved_by
      `);
      const [row] = rows as unknown as Parameters<typeof mapCommentRow>[0][];
      if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
      return mapCommentRow(row);
    }
    const rows = await tx.execute(sql`
      insert into public.comments (card_id, author_id, body, board_id)
      values (${parsed.cardId}, ${authorId}, ${parsed.body}, '00000000-0000-0000-0000-000000000000')
      returning
        id,
        card_id,
        board_id,
        author_id,
        nullif(to_jsonb(comments)->>'parent_comment_id', '')::uuid as parent_comment_id,
        body,
        created_at,
        edited_at,
        nullif(to_jsonb(comments)->>'resolved_at', '')::timestamptz as resolved_at,
        nullif(to_jsonb(comments)->>'resolved_by', '')::uuid as resolved_by
    `);
    const [row] = rows as unknown as Parameters<typeof mapCommentRow>[0][];
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return mapCommentRow(row);
  });
}

export async function editCommentImpl(token: string, input: { id: string; body: string }) {
  const parsed = EditCommentInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const rows = await tx.execute(sql`
      update public.comments
      set body = ${parsed.body}, edited_at = now()
      where id = ${parsed.id}
      returning
        id,
        card_id,
        board_id,
        author_id,
        nullif(to_jsonb(comments)->>'parent_comment_id', '')::uuid as parent_comment_id,
        body,
        created_at,
        edited_at,
        nullif(to_jsonb(comments)->>'resolved_at', '')::timestamptz as resolved_at,
        nullif(to_jsonb(comments)->>'resolved_by', '')::uuid as resolved_by
    `);
    const [row] = rows as unknown as Parameters<typeof mapCommentRow>[0][];
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return mapCommentRow(row);
  });
}

export async function deleteCommentImpl(token: string, input: { id: string }) {
  const parsed = DeleteCommentInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx.delete(comments).where(eq(comments.id, parsed.id))
      .returning({ id: comments.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  });
}

export async function resolveCommentImpl(
  token: string,
  input: { id: string; resolved: boolean },
) {
  const parsed = ResolveCommentInput.parse(input);
  const uid = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(comments)
      .set({
        resolvedAt: parsed.resolved ? sql`now()` : null,
        resolvedBy: parsed.resolved ? uid : null,
        editedAt: sql`now()`,
      })
      .where(eq(comments.id, parsed.id))
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
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
export async function resolveComment(input: { id: string; resolved: boolean }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await resolveCommentImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
