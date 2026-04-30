"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { versions } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateVersionInput,
  UpdateVersionInput,
  DeleteVersionInput,
} from "@/lib/validation";

function toDateOrNull(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v : new Date(v);
}

export async function createVersionImpl(
  token: string,
  input: {
    workspaceId: string;
    name: string;
    semver?: string | null;
    description?: string | null;
    releaseDate?: string | Date | null;
  },
) {
  const p = CreateVersionInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .insert(versions)
      .values({
        workspaceId: p.workspaceId,
        name: p.name,
        semver: p.semver ?? null,
        description: p.description ?? null,
        releaseDate: toDateOrNull(p.releaseDate ?? null),
      })
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function updateVersionImpl(
  token: string,
  input: Parameters<typeof UpdateVersionInput.parse>[0],
) {
  const p = UpdateVersionInput.parse(input);
  return dbAsUser(token, async (tx) => {
    // If releasing without an explicit releaseDate, auto-fill it (only when
    // the existing row's releaseDate is null).
    let autoReleaseDate: Date | undefined;
    if (p.state === "released" && p.releaseDate === undefined) {
      const [existing] = await tx
        .select({ releaseDate: versions.releaseDate })
        .from(versions)
        .where(eq(versions.id, p.id));
      if (existing && existing.releaseDate === null) {
        autoReleaseDate = new Date();
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (p.name !== undefined) patch.name = p.name;
    if (p.semver !== undefined) patch.semver = p.semver;
    if (p.state !== undefined) patch.state = p.state;
    if (p.releaseDate !== undefined)
      patch.releaseDate = toDateOrNull(p.releaseDate);
    else if (autoReleaseDate !== undefined) patch.releaseDate = autoReleaseDate;
    if (p.description !== undefined) patch.description = p.description;

    const [row] = await tx
      .update(versions)
      .set(patch)
      .where(eq(versions.id, p.id))
      .returning();
    if (!row) throw new Error("Forbidden");
    return row;
  });
}

export async function deleteVersionImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteVersionInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(versions)
      .where(eq(versions.id, p.id))
      .returning({ id: versions.id, workspaceId: versions.workspaceId });
    if (r.length === 0) throw new Error("Forbidden");
    return r[0];
  });
}

// Wrappers
export async function createVersion(
  input: Parameters<typeof createVersionImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createVersionImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/versions`);
  revalidatePath(`/w/${r.workspaceId}/settings`);
  return r;
}
export async function updateVersion(
  input: Parameters<typeof updateVersionImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateVersionImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/versions`);
  revalidatePath(`/w/${r.workspaceId}/versions/${r.id}`);
  revalidatePath(`/w/${r.workspaceId}/settings`);
  return r;
}
export async function deleteVersion(input: { id: string }) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await deleteVersionImpl(t, input);
  revalidatePath(`/w/${r.workspaceId}/versions`);
  revalidatePath(`/w/${r.workspaceId}/settings`);
  return r;
}
