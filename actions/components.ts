"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { components } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateComponentInput,
  UpdateComponentInput,
  DeleteComponentInput,
} from "@/lib/validation";

export async function createComponentImpl(
  token: string,
  input: { boardId: string; name: string; leadUserId?: string | null },
) {
  const p = CreateComponentInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .insert(components)
      .values({
        boardId: p.boardId,
        name: p.name,
        leadUserId: p.leadUserId ?? null,
      })
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function updateComponentImpl(
  token: string,
  input: { id: string; name?: string; leadUserId?: string | null },
) {
  const p = UpdateComponentInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name;
  if (p.leadUserId !== undefined) patch.leadUserId = p.leadUserId;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(components)
      .set(patch)
      .where(eq(components.id, p.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteComponentImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteComponentInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(components)
      .where(eq(components.id, p.id))
      .returning({ id: components.id, boardId: components.boardId });
    if (r.length === 0) throw new Error("Forbidden");
    return r[0];
  });
}

// Wrappers
export async function createComponent(
  input: Parameters<typeof createComponentImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createComponentImpl(t, input);
  revalidatePath(`/b/${r.boardId}/settings`);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function updateComponent(
  input: Parameters<typeof updateComponentImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateComponentImpl(t, input);
  revalidatePath(`/b/${r.boardId}/settings`);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
export async function deleteComponent(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await deleteComponentImpl(t, input);
  revalidatePath(`/b/${r.boardId}/settings`);
  revalidatePath(`/b/${r.boardId}`);
  return r;
}
