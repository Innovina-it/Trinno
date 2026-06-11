"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  roadmapBaselines,
  roadmapBaselineEntries,
  roadmapBaselineAssignees,
  roadmapBaselineMilestones,
  cards,
  boards,
} from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateRoadmapBaselineInput,
  UpdateRoadmapBaselineInput,
  DeleteRoadmapBaselineInput,
  GetRoadmapBaselineDetailInput,
  SetApprovedBaselineInput,
} from "@/lib/validation";
import { StructuredError, actionResult } from "@/lib/errors";
import { assertWorkspaceWriter } from "@/lib/permissions/workspace-writer";
import { getWorkspaceRole } from "@/lib/permissions/guest-guard";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

const SOFT_CAP = 25;

export async function createRoadmapBaselineImpl(
  token: string,
  input: { workspaceId: string; name: string; note?: string | null },
) {
  const p = CreateRoadmapBaselineInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    assertWorkspaceWriter(await getWorkspaceRole(tx, p.workspaceId, actor));
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(roadmapBaselines)
      .where(eq(roadmapBaselines.workspaceId, p.workspaceId));
    if (count >= SOFT_CAP)
      throw new StructuredError(
        "LIMIT_REACHED",
        `Baseline limit (${SOFT_CAP}) reached — delete one to continue`,
        { count },
      );
    const [b] = await tx
      .insert(roadmapBaselines)
      .values({
        workspaceId: p.workspaceId,
        name: p.name,
        note: p.note ?? null,
        createdBy: actor,
      })
      .returning();
    // Snapshot the workspace's current roadmap state. Drizzle parameterises
    // the ${...} interpolations, so these are safe.
    await tx.execute(sql`
      insert into roadmap_baseline_entries (baseline_id, card_id, title, start_date, target_date, completed_at, roadmap_order, sprint_id, parent_card_id)
      select ${b.id}, c.id, c.title, c.start_date, c.target_date, c.completed_at, c.roadmap_order, c.sprint_id, c.parent_card_id
      from cards c join boards bo on bo.id = c.board_id
      where bo.workspace_id = ${p.workspaceId} and c.archived = false`);
    await tx.execute(sql`
      insert into roadmap_baseline_assignees (baseline_id, card_id, user_id)
      select ${b.id}, cm.card_id, cm.user_id from card_members cm
      join cards c on c.id = cm.card_id join boards bo on bo.id = c.board_id
      where bo.workspace_id = ${p.workspaceId} and c.archived = false`);
    await tx.execute(sql`
      insert into roadmap_baseline_milestones (baseline_id, milestone_id, name, date)
      select ${b.id}, m.id, m.name, m.date from milestones m where m.workspace_id = ${p.workspaceId}`);
    return b;
  });
}

export async function updateRoadmapBaselineImpl(
  token: string,
  input: { id: string; name?: string; note?: string | null },
) {
  const p = UpdateRoadmapBaselineInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: roadmapBaselines.workspaceId })
      .from(roadmapBaselines)
      .where(eq(roadmapBaselines.id, p.id))
      .limit(1);
    if (!row) throw new StructuredError("NOT_FOUND", "No baseline");
    assertWorkspaceWriter(await getWorkspaceRole(tx, row.workspaceId, actor));
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.note !== undefined) patch.note = p.note;
    if (Object.keys(patch).length)
      await tx
        .update(roadmapBaselines)
        .set(patch)
        .where(eq(roadmapBaselines.id, p.id));
    return { id: p.id, workspaceId: row.workspaceId };
  });
}

export async function deleteRoadmapBaselineImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteRoadmapBaselineInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: roadmapBaselines.workspaceId })
      .from(roadmapBaselines)
      .where(eq(roadmapBaselines.id, p.id))
      .limit(1);
    if (!row) throw new StructuredError("NOT_FOUND", "No baseline");
    assertWorkspaceWriter(await getWorkspaceRole(tx, row.workspaceId, actor));
    await tx.delete(roadmapBaselines).where(eq(roadmapBaselines.id, p.id));
    return { workspaceId: row.workspaceId };
  });
}

export async function getRoadmapBaselineDetailImpl(
  token: string,
  input: { id: string },
) {
  const p = GetRoadmapBaselineDetailInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [meta] = await tx
      .select()
      .from(roadmapBaselines)
      .where(eq(roadmapBaselines.id, p.id))
      .limit(1);
    if (!meta) throw new StructuredError("NOT_FOUND", "No baseline");
    const entries = await tx
      .select()
      .from(roadmapBaselineEntries)
      .where(eq(roadmapBaselineEntries.baselineId, p.id));
    const assignees = await tx
      .select()
      .from(roadmapBaselineAssignees)
      .where(eq(roadmapBaselineAssignees.baselineId, p.id));
    const milestones = await tx
      .select()
      .from(roadmapBaselineMilestones)
      .where(eq(roadmapBaselineMilestones.baselineId, p.id));
    return { meta, entries, assignees, milestones };
  });
}

// Mark exactly ONE baseline per workspace as the approved plan-of-record.
// Runs in a single transaction (dbAsUser opens one) that first clears
// is_approved for every baseline in the workspace, THEN sets it on the target,
// so the partial-unique index (one approved per workspace) never trips during
// the swap. Owner/admin gated to match the rest of this file (and the
// roadmap_baselines admin-write RLS policy).
export async function setApprovedBaselineImpl(
  token: string,
  input: { id: string },
) {
  const p = SetApprovedBaselineInput.parse(input);
  const actor = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: roadmapBaselines.workspaceId })
      .from(roadmapBaselines)
      .where(eq(roadmapBaselines.id, p.id))
      .limit(1);
    if (!row) throw new StructuredError("NOT_FOUND", "No baseline");
    assertWorkspaceWriter(await getWorkspaceRole(tx, row.workspaceId, actor));
    // Unset-then-set: clear all in the workspace, then approve the target.
    await tx
      .update(roadmapBaselines)
      .set({ isApproved: false })
      .where(eq(roadmapBaselines.workspaceId, row.workspaceId));
    await tx
      .update(roadmapBaselines)
      .set({ isApproved: true })
      .where(eq(roadmapBaselines.id, p.id));
    return { id: p.id, workspaceId: row.workspaceId };
  });
}

// Returns the workspace's approved baseline row, or null if none is approved.
export async function getApprovedBaseline(token: string, workspaceId: string) {
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .select()
      .from(roadmapBaselines)
      .where(
        and(
          eq(roadmapBaselines.workspaceId, workspaceId),
          eq(roadmapBaselines.isApproved, true),
        ),
      )
      .limit(1);
    return row ?? null;
  });
}

export async function createRoadmapBaseline(input: {
  workspaceId: string;
  name: string;
  note?: string | null;
}) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await createRoadmapBaselineImpl(t, input);
    revalidatePath(`/w/${input.workspaceId}/roadmap`);
    return r;
  });
}

export async function updateRoadmapBaseline(input: {
  id: string;
  name?: string;
  note?: string | null;
}) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await updateRoadmapBaselineImpl(t, input);
    revalidatePath(`/w/${r.workspaceId}/roadmap`);
    return r;
  });
}

export async function deleteRoadmapBaseline(input: { id: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await deleteRoadmapBaselineImpl(t, input);
    revalidatePath(`/w/${r.workspaceId}/roadmap`);
    return r;
  });
}

export async function getRoadmapBaselineDetail(input: { id: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    return getRoadmapBaselineDetailImpl(t, input);
  });
}

export async function setApprovedBaseline(input: { id: string }) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    const r = await setApprovedBaselineImpl(t, input);
    revalidatePath(`/w/${r.workspaceId}/roadmap`);
    return r;
  });
}

// Lane metadata (boardId + ordering) for a set of card ids, INCLUDING
// archived ones — the roadmap snapshot drops archived cards at the query
// layer, so a baseline's removed-but-archived cards can't be placed back in
// their lane without this. Hard-deleted cards simply don't come back (no row)
// and stay in the removed band. RLS-scoped via dbAsUser; the board join +
// workspace filter keep it to the caller's workspace.
export async function getRemovedCardLaneMetaImpl(
  token: string,
  input: { workspaceId: string; cardIds: string[] },
) {
  const { workspaceId, cardIds } = input;
  if (!workspaceId || !Array.isArray(cardIds) || cardIds.length === 0) return [];
  return dbAsUser(token, async (tx) =>
    tx
      .select({
        id: cards.id,
        boardId: cards.boardId,
        type: cards.type,
        parentCardId: cards.parentCardId,
        roadmapOrder: cards.roadmapOrder,
        priority: cards.priority,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(eq(boards.workspaceId, workspaceId), inArray(cards.id, cardIds)),
      ),
  );
}

export async function getRemovedCardLaneMeta(input: {
  workspaceId: string;
  cardIds: string[];
}) {
  return actionResult(async () => {
    await requireUser();
    const t = (await getSessionToken())!;
    return getRemovedCardLaneMetaImpl(t, input);
  });
}
