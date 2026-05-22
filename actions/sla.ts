"use server";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { slaPolicies } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateSlaPolicyInput,
  UpdateSlaPolicyInput,
  DeleteSlaPolicyInput,
  ScanBoardSlaInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";

export async function createSlaPolicyImpl(
  token: string,
  input: {
    boardId: string;
    name: string;
    targetMin: number;
    appliesWhen?: Record<string, unknown>;
  },
) {
  const p = CreateSlaPolicyInput.parse({
    ...input,
    appliesWhen: input.appliesWhen ?? {},
  });
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .insert(slaPolicies)
      .values({
        boardId: p.boardId,
        name: p.name,
        targetMin: p.targetMin,
        appliesWhen: p.appliesWhen,
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function updateSlaPolicyImpl(
  token: string,
  input: Parameters<typeof UpdateSlaPolicyInput.parse>[0],
) {
  const p = UpdateSlaPolicyInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name;
  if (p.targetMin !== undefined) patch.targetMin = p.targetMin;
  if (p.appliesWhen !== undefined) patch.appliesWhen = p.appliesWhen;
  if (p.enabled !== undefined) patch.enabled = p.enabled;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(slaPolicies)
      .set(patch)
      .where(eq(slaPolicies.id, p.id))
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function deleteSlaPolicyImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteSlaPolicyInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(slaPolicies)
      .where(eq(slaPolicies.id, p.id))
      .returning({ id: slaPolicies.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  });
}

// Scan: for each enabled policy on board, find non-archived cards where
// (now() - cards.created_at) > target_min and there's no active card_sla row,
// insert one and mark breached_at = now(). For cards now archived, mark
// existing card_sla.resolved_at. Delegates to SECURITY DEFINER SQL function
// so writes can bypass the no-user-write RLS policy on card_sla.
export async function scanBoardSlaImpl(
  token: string,
  input: { boardId: string },
) {
  const p = ScanBoardSlaInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const result = await tx.execute(
      sql`select public.scan_board_sla(${p.boardId}::uuid) as active`,
    );
    // postgres-js returns rows as a flat array
    const rows = result as unknown as Array<{ active: number }>;
    const active = rows[0]?.active ?? 0;
    return { breachedActive: Number(active) };
  });
}

// Wrappers
export async function createSlaPolicy(
  input: Parameters<typeof createSlaPolicyImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createSlaPolicyImpl(t, input);
  revalidatePath(`/b/${r.boardId}/settings`);
  return r;
}
export async function updateSlaPolicy(
  input: Parameters<typeof updateSlaPolicyImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateSlaPolicyImpl(t, input);
  revalidatePath(`/b/${r.boardId}/settings`);
  return r;
}
export async function deleteSlaPolicy(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteSlaPolicyImpl(t, input);
}
export async function scanBoardSla(input: { boardId: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await scanBoardSlaImpl(t, input);
  revalidatePath(`/b/${input.boardId}`);
  revalidatePath(`/b/${input.boardId}/settings`);
  return r;
}
