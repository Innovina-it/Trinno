"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, boardMembers, lists, cards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  listBoardsWithLists,
  type BoardWithLists,
} from "@/lib/queries/boards-with-lists";
import {
  CreateBoardInput,
  CreateBoardFromTemplateInput,
  CreateSubboardInput,
  DeleteBoardInput,
  DetachCardSubboardInput,
  PromoteCardToSubboardInput,
  RenameBoardInput,
  SetBoardArchivedInput,
} from "@/lib/validation";
import {
  BOARD_TEMPLATES,
  DEFAULT_LIST_TEMPLATES,
  type BoardTemplateId,
} from "@/lib/board-templates";
import { positionsBetween } from "@/lib/ordering";
import { createListImpl, setListStatusKindImpl } from "@/actions/lists";
import { createLabelImpl } from "@/actions/labels";
import { workspaceMembers } from "@/lib/db/schema";
import { and } from "drizzle-orm";

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
    seedDefaultLists?: boolean;
  },
) {
  const parsed = CreateBoardInput.parse(input);
  const createdBy = decodeSub(token);
  const seedDefaultLists = input.seedDefaultLists ?? true;
  return dbAsUser(token, async (tx) => {
    // Pre-check role: only owner/admin can create boards in a workspace
    // (boards_admin_write RLS, migration 0003). Without this the RLS
    // violation surfaces as a generic 500 to the client — confusing UX
    // when the caller is a workspace `member` who shouldn't have been
    // offered the action in the first place.
    const [membership] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, parsed.workspaceId),
          eq(workspaceMembers.userId, createdBy),
        ),
      );
    if (
      !membership ||
      (membership.role !== "owner" && membership.role !== "admin")
    ) {
      throw new Error(
        "Only workspace owners and admins can create boards in this workspace.",
      );
    }
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
    if (seedDefaultLists && DEFAULT_LIST_TEMPLATES.length > 0) {
      const positions = positionsBetween(null, null, DEFAULT_LIST_TEMPLATES.length);
      await tx.insert(lists).values(
        DEFAULT_LIST_TEMPLATES.map((list, position) => ({
          boardId: b.id,
          title: list.name,
          position: positions[position],
        })),
      );
    }
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
    // Blank template carries no lists of its own — fall through to the
    // DEFAULT_LIST_TEMPLATES seed (Todo / In Progress / Done) so the
    // most common new-board path matches Sheet1's "default lists on
    // board creation" expectation. Named templates supply their own
    // lists below, so we suppress the default seed for them.
    seedDefaultLists: tpl.lists.length === 0,
  });

  const listIds: string[] = [];
  for (const spec of tpl.lists) {
    const row = await createListImpl(token, {
      boardId: board.id,
      title: spec.title,
    });
    listIds.push(row.id);
    if (spec.statusKind) {
      // Plan #epic-as-kanban — migration 0054 enforces unique status per
      // board, but some templates (notably okr_sprint) map two lists to
      // the same conceptual status (e.g. "Backlog" + "This sprint" both
      // todo). Leave the second list unmapped so the rest of the seed
      // continues; the user can adjust mappings via board settings later.
      try {
        await setListStatusKindImpl(token, {
          id: row.id,
          statusKind: spec.statusKind,
        });
      } catch (e) {
        // postgres unique-violation surfaces as code 23505. Drizzle wraps
        // the underlying postgres-js error inside DrizzleQueryError, so
        // the SQLSTATE code lives on `cause.code`. Match defensively on
        // either path or the human message.
        const root = (e as { cause?: { code?: string } } | null | undefined)?.cause;
        const code =
          (e as { code?: string } | null | undefined)?.code ??
          root?.code;
        const msg = e instanceof Error ? e.message : String(e);
        const isDup =
          code === "23505" ||
          /duplicate key|unique constraint|lists_board_id_status_kind/i.test(
            msg,
          );
        if (!isDup) throw e;
      }
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

/**
 * Create a sub-board anchored to an existing card on a parent board.
 *
 * Sub-board = a board with both:
 *   parent_board_id  → the board the anchor card lives on
 *   parent_card_id   → the anchor card (1:1; enforced by partial unique idx)
 *
 * The new board inherits workspace + visibility from the parent board and
 * seeds default lists. Creator is added as board admin so the same
 * boards_admin_write RLS path used by `createBoardImpl` applies.
 *
 * Caller must hold workspace owner/admin OR parent board admin role —
 * `boards_admin_write` enforces this; we pre-check workspace role to fail
 * fast with a readable message in the common "member tried to promote"
 * case (parity with createBoardImpl).
 */
export async function createSubboardImpl(
  token: string,
  input: { parentBoardId: string; parentCardId: string; title: string },
) {
  const parsed = CreateSubboardInput.parse(input);
  const createdBy = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [parent] = await tx
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        backgroundKind: boards.backgroundKind,
        backgroundValue: boards.backgroundValue,
        visibility: boards.visibility,
      })
      .from(boards)
      .where(eq(boards.id, parsed.parentBoardId));
    if (!parent) throw new Error("Parent board not found.");

    const [anchor] = await tx
      .select({ id: cards.id, boardId: cards.boardId })
      .from(cards)
      .where(eq(cards.id, parsed.parentCardId));
    if (!anchor) throw new Error("Anchor card not found.");
    if (anchor.boardId !== parent.id) {
      throw new Error("Anchor card does not belong to the parent board.");
    }

    const [membership] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, parent.workspaceId),
          eq(workspaceMembers.userId, createdBy),
        ),
      );
    if (
      !membership ||
      (membership.role !== "owner" && membership.role !== "admin")
    ) {
      throw new Error(
        "Only workspace owners and admins can create sub-boards.",
      );
    }

    const [b] = await tx
      .insert(boards)
      .values({
        workspaceId: parent.workspaceId,
        title: parsed.title,
        backgroundKind: parent.backgroundKind,
        backgroundValue: parent.backgroundValue,
        visibility: parent.visibility,
        parentBoardId: parent.id,
        parentCardId: anchor.id,
        createdBy,
      })
      .returning();
    if (!b) throw new Error("Forbidden");
    await tx.insert(boardMembers).values({
      boardId: b.id,
      userId: createdBy,
      role: "admin",
    });
    if (DEFAULT_LIST_TEMPLATES.length > 0) {
      const positions = positionsBetween(null, null, DEFAULT_LIST_TEMPLATES.length);
      await tx.insert(lists).values(
        DEFAULT_LIST_TEMPLATES.map((list, position) => ({
          boardId: b.id,
          title: list.name,
          position: positions[position],
        })),
      );
    }
    return b;
  });
}

/**
 * Promote an existing card into a sub-board anchor. Looks up the card's
 * board + title, then delegates to `createSubboardImpl`. Idempotency is
 * enforced by the partial unique index on `boards.parent_card_id` — a
 * second call for the same card surfaces as a uniqueness error.
 */
export async function promoteCardToSubboardImpl(
  token: string,
  input: { cardId: string },
) {
  const parsed = PromoteCardToSubboardInput.parse(input);
  const anchor = await dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ id: cards.id, boardId: cards.boardId, title: cards.title })
      .from(cards)
      .where(eq(cards.id, parsed.cardId));
    return row ?? null;
  });
  if (!anchor) throw new Error("Card not found.");
  return createSubboardImpl(token, {
    parentBoardId: anchor.boardId,
    parentCardId: anchor.id,
    title: anchor.title,
  });
}

/**
 * Detach a card's sub-board pointer. Clears `boards.parent_card_id` so
 * the child board becomes orphaned (still accessible from the workspace
 * board list) instead of cascade-deleted. Reversible: re-promoting the
 * card creates a fresh sub-board.
 *
 * Returns the affected sub-board id (or null when nothing was attached).
 */
export async function detachCardSubboardImpl(
  token: string,
  input: { cardId: string },
) {
  const parsed = DetachCardSubboardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(boards)
      .set({ parentCardId: null })
      .where(eq(boards.parentCardId, parsed.cardId))
      .returning({ id: boards.id, parentBoardId: boards.parentBoardId });
    return row ?? null;
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

export async function createBoardFromTemplate(
  input: Parameters<typeof createBoardFromTemplateImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const r = await createBoardFromTemplateImpl(token, input);
  revalidatePath(`/w/${input.workspaceId}`);
  return r;
}

export async function createSubboard(
  input: Parameters<typeof createSubboardImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await createSubboardImpl(token, input);
  revalidatePath(`/b/${input.parentBoardId}`);
  revalidatePath(`/b/${b.id}`);
  return b;
}

export async function promoteCardToSubboard(
  input: Parameters<typeof promoteCardToSubboardImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await promoteCardToSubboardImpl(token, input);
  if (b.parentBoardId) revalidatePath(`/b/${b.parentBoardId}`);
  revalidatePath(`/b/${b.id}`);
  return b;
}

export async function detachCardSubboard(
  input: Parameters<typeof detachCardSubboardImpl>[1],
) {
  await requireUser();
  const token = (await getSessionToken())!;
  const row = await detachCardSubboardImpl(token, input);
  if (row?.parentBoardId) revalidatePath(`/b/${row.parentBoardId}`);
  return row;
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

// Plan #16b-γ-D (#6, #37, #38) — server action wrapper around
// `listBoardsWithLists` so client components (quick-add card dialog,
// move-to-board dialog, cross-board link picker) can fetch the
// destination tree on-open.
export async function getBoardsWithLists(): Promise<BoardWithLists[]> {
  await requireUser();
  const token = (await getSessionToken())!;
  return listBoardsWithLists(token);
}
