"use server";
import { revalidatePath } from "next/cache";
import { and, eq, asc, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { gadgets } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateGadgetInput,
  UpdateGadgetInput,
  DeleteGadgetInput,
  MoveGadgetInput,
  ReorderGadgetsInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";

export async function createGadgetImpl(
  token: string,
  input: {
    dashboardId: string;
    type:
      | "count"
      | "recent_activity"
      | "assigned_to_me"
      | "due_this_week"
      | "velocity"
      | "burndown"
      | "cards_by_type"
      | "markdown_note"
      | "on_roadmap";
    config?: Record<string, unknown>;
    size?: "1x1" | "2x1" | "2x2" | "3x1" | "3x2";
  },
) {
  const p = CreateGadgetInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [maxRow] = await tx
      .select({ m: sql<number>`coalesce(max(${gadgets.position}), -1)::int` })
      .from(gadgets)
      .where(eq(gadgets.dashboardId, p.dashboardId));
    const nextPos = (maxRow?.m ?? -1) + 1;
    const [row] = await tx
      .insert(gadgets)
      .values({
        dashboardId: p.dashboardId,
        type: p.type,
        config: p.config,
        size: p.size,
        position: nextPos,
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function updateGadgetImpl(
  token: string,
  input: {
    id: string;
    config?: Record<string, unknown>;
    size?: "1x1" | "2x1" | "2x2" | "3x1" | "3x2";
  },
) {
  const p = UpdateGadgetInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (p.config !== undefined) patch.config = p.config;
  if (p.size !== undefined) patch.size = p.size;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(gadgets)
      .set(patch)
      .where(eq(gadgets.id, p.id))
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function removeGadgetImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteGadgetInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(gadgets)
      .where(eq(gadgets.id, p.id))
      .returning({ id: gadgets.id, dashboardId: gadgets.dashboardId });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return r[0];
  });
}

export async function moveGadgetImpl(
  token: string,
  input: { id: string; direction: "up" | "down" },
) {
  const p = MoveGadgetInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [target] = await tx
      .select()
      .from(gadgets)
      .where(eq(gadgets.id, p.id));
    if (!target) throw new StructuredError("ACCESS_DENIED", "Forbidden");

    const all = await tx
      .select()
      .from(gadgets)
      .where(eq(gadgets.dashboardId, target.dashboardId))
      .orderBy(asc(gadgets.position));

    const idx = all.findIndex((g) => g.id === p.id);
    if (idx < 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    const neighbourIdx = p.direction === "up" ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= all.length) {
      // No-op at boundary.
      return { id: target.id, dashboardId: target.dashboardId };
    }
    const a = all[idx];
    const b = all[neighbourIdx];

    // Swap by using temporary out-of-band positions to avoid an index collision
    // on (dashboard_id, position) — although there's no unique constraint, be safe.
    await tx
      .update(gadgets)
      .set({ position: -1 })
      .where(eq(gadgets.id, a.id));
    await tx
      .update(gadgets)
      .set({ position: a.position })
      .where(eq(gadgets.id, b.id));
    await tx
      .update(gadgets)
      .set({ position: b.position })
      .where(eq(gadgets.id, a.id));

    return { id: target.id, dashboardId: target.dashboardId };
  });
}

// Wrappers
export async function createGadget(
  input: Parameters<typeof createGadgetImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createGadgetImpl(t, input);
  revalidatePath(`/dashboards/${input.dashboardId}`);
  return r;
}

export async function updateGadget(
  input: Parameters<typeof updateGadgetImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateGadgetImpl(t, input);
  revalidatePath(`/dashboards/${r.dashboardId}`);
  return r;
}

export async function removeGadget(
  input: Parameters<typeof removeGadgetImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await removeGadgetImpl(t, input);
  revalidatePath(`/dashboards/${r.dashboardId}`);
  return r;
}

export async function moveGadget(
  input: Parameters<typeof moveGadgetImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await moveGadgetImpl(t, input);
  revalidatePath(`/dashboards/${r.dashboardId}`);
  return r;
}

export async function reorderGadgetsImpl(
  token: string,
  input: { dashboardId: string; orderedIds: string[] },
) {
  const p = ReorderGadgetsInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const all = await tx
      .select({ id: gadgets.id })
      .from(gadgets)
      .where(eq(gadgets.dashboardId, p.dashboardId));
    const existing = new Set(all.map((g) => g.id));
    if (existing.size !== p.orderedIds.length) {
      throw new StructuredError("VALIDATION_ERROR", "Reorder set mismatch", { kind: "gadget-reorder-mismatch" });
    }
    for (const id of p.orderedIds) {
      if (!existing.has(id)) throw new StructuredError("VALIDATION_ERROR", "Reorder set mismatch", { kind: "gadget-reorder-mismatch" });
    }
    // Two-phase update to avoid intermediate position collisions if a unique
    // index is later added on (dashboard_id, position).
    for (let i = 0; i < p.orderedIds.length; i++) {
      await tx
        .update(gadgets)
        .set({ position: -1000 - i })
        .where(
          and(
            eq(gadgets.id, p.orderedIds[i]),
            eq(gadgets.dashboardId, p.dashboardId),
          ),
        );
    }
    for (let i = 0; i < p.orderedIds.length; i++) {
      await tx
        .update(gadgets)
        .set({ position: i })
        .where(
          and(
            eq(gadgets.id, p.orderedIds[i]),
            eq(gadgets.dashboardId, p.dashboardId),
          ),
        );
    }
    return { dashboardId: p.dashboardId };
  });
}

export async function reorderGadgets(
  input: Parameters<typeof reorderGadgetsImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await reorderGadgetsImpl(t, input);
  revalidatePath(`/dashboards/${r.dashboardId}`);
  return r;
}
