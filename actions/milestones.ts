"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, or } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { milestones } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateMilestoneInput,
  UpdateMilestoneInput,
  DeleteMilestoneInput,
} from "@/lib/validation";

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
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
    const [row] = await tx
      .insert(milestones)
      .values({
        workspaceId: p.workspaceId,
        boardId: p.boardId ?? null,
        name: p.name,
        date: toDate(p.date),
        description: p.description ?? null,
        color: p.color ?? "#6366f1",
        icon: p.icon ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function updateMilestoneImpl(
  token: string,
  input: Parameters<typeof UpdateMilestoneInput.parse>[0],
) {
  const p = UpdateMilestoneInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.boardId !== undefined) patch.boardId = p.boardId;
    if (p.date !== undefined) patch.date = toDate(p.date);
    if (p.description !== undefined) patch.description = p.description;
    if (p.color !== undefined) patch.color = p.color;
    if (p.icon !== undefined) patch.icon = p.icon;

    const [row] = await tx
      .update(milestones)
      .set(patch)
      .where(eq(milestones.id, p.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteMilestoneImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteMilestoneInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(milestones)
      .where(eq(milestones.id, p.id))
      .returning({ id: milestones.id, workspaceId: milestones.workspaceId });
    if (r.length === 0) throw new Error("Forbidden");
    return r[0]!;
  });
}

export async function listMilestonesImpl(
  token: string,
  workspaceId: string,
  boardId?: string | null,
) {
  return dbAsUser(token, async (tx) => {
    const condition = boardId
      ? and(
          eq(milestones.workspaceId, workspaceId),
          or(
            eq(milestones.boardId, boardId),
            isNull(milestones.boardId),
          ),
        )
      : eq(milestones.workspaceId, workspaceId);

    return tx
      .select()
      .from(milestones)
      .where(condition)
      .orderBy(milestones.date);
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
