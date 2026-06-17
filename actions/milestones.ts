"use server";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, cards, lists } from "@/lib/db/schema";
import { positionBetween } from "@/lib/ordering";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateMilestoneInput,
  UpdateMilestoneInput,
  DeleteMilestoneInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";

// milestone-as-card — milestones are now cards with type="milestone", hosted
// in a hidden "Milestones" list so they never show on the board. The action
// signatures and the MilestoneRow shape below are preserved so the roadmap UI
// and its undo/redo wiring keep working unchanged; only the storage swapped.
const MILESTONE_TYPE = "milestone";
const MILESTONE_LIST_TITLE = "Milestones";
const DEFAULT_MILESTONE_COLOR = "#6366f1";
const BOARD_ID_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

type MilestoneRow = {
  id: string;
  workspaceId: string;
  boardId: string | null;
  name: string;
  date: Date;
  description: string | null;
  color: string;
  icon: string | null;
};

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

type MilestoneCard = {
  id: string;
  boardId: string;
  title: string;
  startDate: Date | null;
  targetDate: Date | null;
  description: string | null;
  coverColor: string | null;
  icon: string | null;
};

function cardToMilestoneRow(c: MilestoneCard, workspaceId: string): MilestoneRow {
  return {
    id: c.id,
    workspaceId,
    boardId: c.boardId,
    name: c.title,
    date: c.targetDate ?? c.startDate ?? toDate(new Date()),
    description: c.description ?? null,
    color: c.coverColor ?? DEFAULT_MILESTONE_COLOR,
    icon: c.icon ?? null,
  };
}

// Resolve the board that physically stores a workspace's milestone cards.
// An explicit boardId wins; otherwise the workspace's oldest board hosts them
// (storage detail — the roadmap reads milestones workspace-wide regardless).
async function resolveHostBoard(
  tx: Parameters<Parameters<typeof dbAsUser>[1]>[0],
  workspaceId: string,
  boardId: string | null,
): Promise<string> {
  if (boardId) return boardId;
  const [b] = await tx
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.workspaceId, workspaceId))
    .orderBy(asc(boards.createdAt))
    .limit(1);
  if (!b) {
    throw new StructuredError(
      "VALIDATION",
      "Create a board before adding milestones.",
    );
  }
  return b.id;
}

// Find-or-create the hidden "Milestones" list on a board.
async function ensureMilestoneList(
  tx: Parameters<Parameters<typeof dbAsUser>[1]>[0],
  boardId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: lists.id })
    .from(lists)
    .where(
      and(
        eq(lists.boardId, boardId),
        eq(lists.hidden, true),
        eq(lists.title, MILESTONE_LIST_TITLE),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [last] = await tx
    .select({ position: lists.position })
    .from(lists)
    .where(eq(lists.boardId, boardId))
    .orderBy(desc(lists.position))
    .limit(1);
  const [created] = await tx
    .insert(lists)
    .values({
      boardId,
      title: MILESTONE_LIST_TITLE,
      position: positionBetween(last?.position ?? null, null),
      hidden: true,
    })
    .returning({ id: lists.id });
  if (!created) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  return created.id;
}

async function workspaceOfBoard(
  tx: Parameters<Parameters<typeof dbAsUser>[1]>[0],
  boardId: string,
): Promise<string> {
  const [b] = await tx
    .select({ wid: boards.workspaceId })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1);
  return b?.wid ?? "";
}

// ── impl helpers (accept pre-fetched token) ──────────────────────────────────

export async function createMilestoneImpl(
  token: string,
  input: {
    workspaceId: string;
    boardId?: string | null;
    name: string;
    date: string | Date;
    description?: string | null;
    color?: string;
    icon?: string | null;
    createdBy: string;
  },
) {
  const p = CreateMilestoneInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const hostBoardId = await resolveHostBoard(tx, p.workspaceId, p.boardId ?? null);
    const listId = await ensureMilestoneList(tx, hostBoardId);
    const [last] = await tx
      .select({ position: cards.position })
      .from(cards)
      .where(eq(cards.listId, listId))
      .orderBy(desc(cards.position))
      .limit(1);
    const d = toDate(p.date);
    const [card] = await tx
      .insert(cards)
      .values({
        listId,
        boardId: BOARD_ID_PLACEHOLDER, // cards_set_board_id trigger fills from listId
        title: p.name,
        type: MILESTONE_TYPE,
        position: positionBetween(last?.position ?? null, null),
        startDate: d,
        targetDate: d,
        description: p.description ?? null,
        coverColor: p.color ?? DEFAULT_MILESTONE_COLOR,
        icon: p.icon ?? null,
        ownerId: input.createdBy,
      })
      .returning();
    if (!card) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return cardToMilestoneRow(card, p.workspaceId);
  });
}

export async function updateMilestoneImpl(
  token: string,
  input: Parameters<typeof UpdateMilestoneInput.parse>[0],
) {
  const p = UpdateMilestoneInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.title = p.name;
    if (p.date !== undefined) {
      const d = toDate(p.date);
      patch.startDate = d;
      patch.targetDate = d;
    }
    if (p.description !== undefined) patch.description = p.description;
    if (p.color !== undefined) patch.coverColor = p.color;
    if (p.icon !== undefined) patch.icon = p.icon;
    // p.boardId is intentionally ignored: the host board (storage) doesn't
    // move on edit, and milestone board-scope is unused by any caller.

    const [card] = await tx
      .update(cards)
      .set(patch)
      .where(and(eq(cards.id, p.id), eq(cards.type, MILESTONE_TYPE)))
      .returning();
    if (!card) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return cardToMilestoneRow(card, await workspaceOfBoard(tx, card.boardId));
  });
}

export async function deleteMilestoneImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteMilestoneInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [existing] = await tx
      .select({ boardId: cards.boardId })
      .from(cards)
      .where(and(eq(cards.id, p.id), eq(cards.type, MILESTONE_TYPE)))
      .limit(1);
    if (!existing) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    const workspaceId = await workspaceOfBoard(tx, existing.boardId);
    const r = await tx
      .delete(cards)
      .where(and(eq(cards.id, p.id), eq(cards.type, MILESTONE_TYPE)))
      .returning({ id: cards.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return { id: r[0]!.id, workspaceId };
  });
}

export async function listMilestonesImpl(
  token: string,
  workspaceId: string,
  boardId?: string | null,
) {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        id: cards.id,
        boardId: cards.boardId,
        title: cards.title,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
        description: cards.description,
        coverColor: cards.coverColor,
        icon: cards.icon,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(
          eq(boards.workspaceId, workspaceId),
          eq(cards.type, MILESTONE_TYPE),
          eq(cards.archived, false),
          boardId ? eq(cards.boardId, boardId) : undefined,
        ),
      )
      .orderBy(asc(cards.targetDate));
    return rows.map((r) => cardToMilestoneRow(r, workspaceId));
  });
}

// ── Public server actions ────────────────────────────────────────────────────

export async function createMilestone(
  input: Omit<Parameters<typeof createMilestoneImpl>[1], "createdBy">,
) {
  const user = await requireUser();
  const t = (await getSessionToken())!;
  const r = await createMilestoneImpl(t, { ...input, createdBy: user.id });
  revalidatePath(`/w/${r.workspaceId}/roadmap`);
  return r;
}

export async function updateMilestone(
  input: Parameters<typeof updateMilestoneImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateMilestoneImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/roadmap`);
  return r;
}

export async function deleteMilestone(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await deleteMilestoneImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/roadmap`);
  return r;
}

export async function listMilestones(
  workspaceId: string,
  boardId?: string | null,
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return listMilestonesImpl(t, workspaceId, boardId);
}
