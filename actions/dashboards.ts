"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { dashboards } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateDashboardInput,
  UpdateDashboardInput,
  DeleteDashboardInput,
} from "@/lib/validation";
import { StructuredError } from "@/lib/errors";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createDashboardImpl(
  token: string,
  input: {
    name: string;
    scope: "personal" | "workspace";
    workspaceId?: string | null;
  },
) {
  const p = CreateDashboardInput.parse(input);
  const ownerId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .insert(dashboards)
      .values({
        ownerId,
        scope: p.scope,
        workspaceId: p.scope === "workspace" ? (p.workspaceId ?? null) : null,
        name: p.name,
      })
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function updateDashboardImpl(
  token: string,
  input: { id: string; name?: string },
) {
  const p = UpdateDashboardInput.parse(input);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (p.name !== undefined) patch.name = p.name;
  return dbAsUser(token, async (tx) => {
    const [row] = await tx
      .update(dashboards)
      .set(patch)
      .where(eq(dashboards.id, p.id))
      .returning();
    if (!row) throw new StructuredError("ACCESS_DENIED", "Forbidden");
    return row;
  });
}

export async function deleteDashboardImpl(
  token: string,
  input: { id: string },
) {
  const p = DeleteDashboardInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(dashboards)
      .where(eq(dashboards.id, p.id))
      .returning({ id: dashboards.id });
    if (r.length === 0) throw new StructuredError("ACCESS_DENIED", "Forbidden");
  });
}

// Wrappers
export async function createDashboard(
  input: Parameters<typeof createDashboardImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await createDashboardImpl(t, input);
  revalidatePath("/dashboards");
  return r;
}

export async function updateDashboard(
  input: Parameters<typeof updateDashboardImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await updateDashboardImpl(t, input);
  revalidatePath("/dashboards");
  revalidatePath(`/dashboards/${r.id}`);
  return r;
}

export async function deleteDashboard(
  input: Parameters<typeof deleteDashboardImpl>[1],
) {
  await requireUser();
  const t = (await getSessionToken())!;
  await deleteDashboardImpl(t, input);
  revalidatePath("/dashboards");
}
