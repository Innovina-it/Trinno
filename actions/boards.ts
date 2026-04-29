"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, boardMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateBoardInput,
  DeleteBoardInput,
  RenameBoardInput,
  SetBoardArchivedInput,
} from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createBoardImpl(
  token: string,
  input: {
    workspaceId: string;
    title: string;
    backgroundKind: "color" | "image";
    backgroundValue: string;
  },
) {
  const parsed = CreateBoardInput.parse(input);
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [b] = await tx
      .insert(boards)
      .values({
        workspaceId: parsed.workspaceId,
        title: parsed.title,
        backgroundKind: parsed.backgroundKind,
        backgroundValue: parsed.backgroundValue,
        createdBy,
      })
      .returning();
    if (!b) throw new Error("Forbidden");
    await tx.insert(boardMembers).values({
      boardId: b.id,
      userId: createdBy,
      role: "admin",
    });
    return b;
  });
}

export async function renameBoardImpl(
  token: string,
  input: { id: string; title: string },
) {
  const parsed = RenameBoardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(boards)
      .set({ title: parsed.title })
      .where(eq(boards.id, parsed.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function setBoardArchivedImpl(
  token: string,
  input: { id: string; archived: boolean },
) {
  const parsed = SetBoardArchivedInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(boards)
      .set({ archived: parsed.archived })
      .where(eq(boards.id, parsed.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteBoardImpl(
  token: string,
  input: { id: string },
) {
  const parsed = DeleteBoardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(boards)
      .where(eq(boards.id, parsed.id))
      .returning({ id: boards.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function createBoard(
  input: Parameters<typeof createBoardImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await createBoardImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}`);
  return b;
}

export async function renameBoard(
  input: Parameters<typeof renameBoardImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await renameBoardImpl(token, input);
  revalidatePath(`/b/${b.id}`);
  return b;
}

export async function setBoardArchived(
  input: Parameters<typeof setBoardArchivedImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await setBoardArchivedImpl(token, input);
  revalidatePath(`/w/${b.workspaceId}`);
  return b;
}

export async function deleteBoard(
  input: Parameters<typeof deleteBoardImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  await deleteBoardImpl(token, input);
}
