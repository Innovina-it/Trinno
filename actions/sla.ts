"use server";
import { revalidatePath } from "next/cache";
import { eq, and, isNull, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { slaPolicies, cardSla } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateSlaPolicyInput,
  UpdateSlaPolicyInput,
  DeleteSlaPolicyInput,
  ScanBoardSlaInput,
} from "@/lib/validation";

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
    if (!row) throw new Error("Forbidden");
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
    if (!row) throw new Error("Forbidden");
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
    if (r.length === 0) throw new Error("Forbidden");
  });
}

// Scan: for each enabled policy on board, find non-archived cards where
// (now() - cards.created_at) > target_min and there's no active card_sla row,
// insert one and mark breached_at = now(). For cards now archived, mark
// existing card_sla.resolved_at.
export async function scanBoardSlaImpl(
  token: string,
  input: { boardId: string },
) {
  const p = ScanBoardSlaInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // Resolve already-resolved breaches first
    await tx.execute(sql`
      update public.card_sla cs
        set resolved_at = now()
        where cs.board_id = ${p.boardId}
          and cs.resolved_at is null
          and exists (
            select 1 from public.cards c where c.id = cs.card_id and c.archived = true
          )
    `);

    // Insert breach rows for each policy/card combination that has crossed target.
    await tx.execute(sql`
      insert into public.card_sla (card_id, sla_id, board_id, started_at, breached_at)
      select c.id, p.id, c.board_id, c.created_at, now()
      from public.cards c
      join public.sla_policies p on p.board_id = c.board_id
      where p.board_id = ${p.boardId}
        and p.enabled = true
        and c.archived = false
        and (extract(epoch from now() - c.created_at) / 60) > p.target_min
        and not exists (
          select 1 from public.card_sla cs
            where cs.card_id = c.id and cs.sla_id = p.id
        )
      on conflict (card_id, sla_id) do nothing
    `);

    const breached = await tx
      .select({
        cardId: cardSla.cardId,
        slaId: cardSla.slaId,
        breachedAt: cardSla.breachedAt,
      })
      .from(cardSla)
      .where(and(eq(cardSla.boardId, p.boardId), isNull(cardSla.resolvedAt)));

    return { breachedActive: breached.length };
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
