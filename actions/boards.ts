"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, boardMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateBoardInput,
  CreateBoardFromTemplateInput,
  DeleteBoardInput,
  RenameBoardInput,
  SetBoardArchivedInput,
} from "@/lib/validation";
import {
  BOARD_TEMPLATES,
  type BoardTemplateId,
} from "@/lib/board-templates";
import { createListImpl, setListStatusKindImpl } from "@/actions/lists";
import { createLabelImpl } from "@/actions/labels";

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

/**
 * Plan #16b-γ-B (#2) — Create a board pre-populated from a named template.
 *
 * Sequence (no shared transaction — each impl manages its own dbAsUser
 * scope):
 *   1. createBoardImpl → board row + admin board_member.
 *   2. For each template list (in declared order) call createListImpl. The
 *      impl's `desc(position)` lookup means each subsequent list lands at
 *      the tail, preserving the declared order.
 *   3. Map each new list's statusKind via setListStatusKindImpl when the
 *      template specifies one.
 *   4. Insert each label via createLabelImpl.
 *
 * Returns the board row plus the ordered list ids so the caller (typically
 * the new-board dialog) can navigate or seed cards.
 */
export async function createBoardFromTemplateImpl(
  token: string,
  input: {
    workspaceId: string;
    title: string;
    backgroundKind: "color" | "image";
    backgroundValue: string;
    templateId: BoardTemplateId;
  },
) {
  const parsed = CreateBoardFromTemplateInput.parse(input);
  const tpl = BOARD_TEMPLATES.find((t) => t.id === parsed.templateId);
  if (!tpl) throw new Error(`Unknown template: ${parsed.templateId}`);

  const board = await createBoardImpl(token, {
    workspaceId: parsed.workspaceId,
    title: parsed.title,
    backgroundKind: parsed.backgroundKind,
    backgroundValue: parsed.backgroundValue,
  });

  const listIds: string[] = [];
  for (const spec of tpl.lists) {
    const row = await createListImpl(token, {
      boardId: board.id,
      title: spec.title,
    });
    listIds.push(row.id);
    if (spec.statusKind) {
      await setListStatusKindImpl(token, {
        id: row.id,
        statusKind: spec.statusKind,
      });
    }
  }

  for (const lab of tpl.labels) {
    await createLabelImpl(token, {
      boardId: board.id,
      name: lab.name,
      color: lab.color,
    });
  }

  return { board, listIds };
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

export async function createBoardFromTemplate(
  input: Parameters<typeof createBoardFromTemplateImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await createBoardFromTemplateImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}`);
  return r;
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
