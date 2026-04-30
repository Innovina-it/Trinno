"use server";
import { revalidatePath } from "next/cache";
import { eq, and, inArray } from "drizzle-orm";
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
  BulkShiftCardDatesInput,
} from "@/lib/validation";

// Plan #16b-β — type for the conflict-card payload returned by
// `startSprintImpl`. A "conflict" is a card whose dates fall outside the
// just-started sprint window so it would visually drift on the roadmap.
export type SprintConflictCard = {
  id: string;
  title: string;
  boardId: string;
  startDate: Date | null;
  targetDate: Date | null;
};

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

export async function startSprintImpl(
  token: string,
  input: { id: string },
): Promise<{
  sprint: typeof sprints.$inferSelect;
  conflictCards: SprintConflictCard[];
}> {
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
    // Plan #16b-β — surface cards whose start/target dates fall outside
    // the (now-known) sprint window so the UI can offer a bulk shift.
    let conflictCards: SprintConflictCard[] = [];
    if (row.startDate && row.endDate) {
      const sprintStart = row.startDate;
      const sprintEnd = row.endDate;
      const cardRows = await tx
        .select({
          id: cards.id,
          title: cards.title,
          boardId: cards.boardId,
          startDate: cards.startDate,
          targetDate: cards.targetDate,
        })
        .from(cards)
        .where(
          and(eq(cards.sprintId, row.id), eq(cards.archived, false)),
        );
      conflictCards = cardRows.filter((c) => {
        const startsBefore =
          c.startDate !== null && c.startDate < sprintStart;
        const endsAfter =
          c.targetDate !== null && c.targetDate > sprintEnd;
        return startsBefore || endsAfter;
      });
    }
    return { sprint: row, conflictCards };
  });
}

// Plan #16b-β — shift start/target dates by `deltaMinutes` for a set of
// cards. Runs in a single transaction so partial failure can't leave
// half-shifted state. RLS still scopes the update to rows the caller can
// modify.
export async function bulkShiftCardDatesImpl(
  token: string,
  input: { cardIds: string[]; deltaMinutes: number },
): Promise<{ updated: number }> {
  const p = BulkShiftCardDatesInput.parse(input);
  if (p.cardIds.length === 0) return { updated: 0 };
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        id: cards.id,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
      })
      .from(cards)
      .where(inArray(cards.id, p.cardIds));
    const deltaMs = p.deltaMinutes * 60_000;
    let updated = 0;
    for (const r of rows) {
      const patch: Record<string, unknown> = {};
      if (r.startDate)
        patch.startDate = new Date(r.startDate.getTime() + deltaMs);
      if (r.targetDate)
        patch.targetDate = new Date(r.targetDate.getTime() + deltaMs);
      if (Object.keys(patch).length === 0) continue;
      const result = await tx
        .update(cards)
        .set(patch)
        .where(eq(cards.id, r.id))
        .returning({ id: cards.id });
      if (result.length > 0) updated += 1;
    }
    return { updated };
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
  revalidatePath(`/w/${r.sprint.workspaceId}/backlog`);
  return r;
}

export async function bulkShiftCardDates(
  input: Parameters<typeof bulkShiftCardDatesImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  return bulkShiftCardDatesImpl(t, input);
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
