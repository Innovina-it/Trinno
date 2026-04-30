"use server";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateSprintInput,
  UpdateSprintInput,
  DeleteSprintInput,
  StartSprintInput,
  CompleteSprintInput,
  AssignCardToSprintInput,
} from "@/lib/validation";

function asDate(v: string | Date | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

export async function createSprintImpl(
  token: string,
  input: {
    workspaceId: string;
    name: string;
    goal?: string | null;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
  },
) {
  const p = CreateSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .insert(sprints)
      .values({
        workspaceId: p.workspaceId,
        name: p.name,
        goal: p.goal ?? null,
        startDate: asDate(p.startDate) ?? null,
        endDate: asDate(p.endDate) ?? null,
      })
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function updateSprintImpl(
  token: string,
  input: {
    id: string;
    name?: string;
    goal?: string | null;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
  },
) {
  const p = UpdateSprintInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name;
  if (p.goal !== undefined) patch.goal = p.goal;
  if (p.startDate !== undefined) patch.startDate = asDate(p.startDate);
  if (p.endDate !== undefined) patch.endDate = asDate(p.endDate);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(sprints)
      .set(patch)
      .where(eq(sprints.id, p.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteSprintImpl(token: string, input: { id: string }) {
  const p = DeleteSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(sprints)
      .where(eq(sprints.id, p.id))
      .returning({ id: sprints.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function startSprintImpl(token: string, input: { id: string }) {
  const p = StartSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Postgres' partial unique index will reject if another active sprint exists.
    const [row] = await tx
      .update(sprints)
      .set({ state: "active", startDate: new Date() })
      .where(and(eq(sprints.id, p.id), eq(sprints.state, "planned")))
      .returning();
    if (!row)
      throw new Error(
        "Cannot start: not planned, or another sprint is already active",
      );
    return row;
  });
}

export async function completeSprintImpl(
  token: string,
  input: { id: string; carryoverTo: "backlog" | string },
) {
  const p = CompleteSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Move incomplete (non-archived) cards to carryover destination.
    if (p.carryoverTo === "backlog") {
      await tx
        .update(cards)
        .set({ sprintId: null })
        .where(and(eq(cards.sprintId, p.id), eq(cards.archived, false)));
    } else {
      await tx
        .update(cards)
        .set({ sprintId: p.carryoverTo })
        .where(and(eq(cards.sprintId, p.id), eq(cards.archived, false)));
    }
    const [row] = await tx
      .update(sprints)
      .set({ state: "completed", completedAt: new Date() })
      .where(and(eq(sprints.id, p.id), eq(sprints.state, "active")))
      .returning();
    if (!row) throw new Error("Cannot complete: sprint is not active");
    return row;
  });
}

export async function assignCardToSprintImpl(
  token: string,
  input: { cardId: string; sprintId: string | null },
) {
  const p = AssignCardToSprintInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(cards)
      .set({ sprintId: p.sprintId })
      .where(eq(cards.id, p.cardId))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

// Wrappers
export async function createSprint(
  input: Parameters<typeof createSprintImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createSprintImpl(t, input);
  revalidatePath(`/w/${input.workspaceId}/backlog`);
  return r;
}
export async function updateSprint(
  input: Parameters<typeof updateSprintImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateSprintImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/backlog`);
  return r;
}
export async function deleteSprint(
  input: Parameters<typeof deleteSprintImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteSprintImpl(t, input);
}
export async function startSprint(
  input: Parameters<typeof startSprintImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await startSprintImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/backlog`);
  return r;
}
export async function completeSprint(
  input: Parameters<typeof completeSprintImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await completeSprintImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/backlog`);
  return r;
}
export async function assignCardToSprint(
  input: Parameters<typeof assignCardToSprintImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await assignCardToSprintImpl(t, input);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
