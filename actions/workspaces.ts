"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaces, workspaceMembers } from "@/lib/db/schema";
import { getSessionToken, requireUser } from "@/lib/auth";
import {
  CreateWorkspaceInput,
  DeleteWorkspaceInput,
  RenameWorkspaceInput,
  SetWorkspaceAutoAssignCreatorInput,
} from "@/lib/validation";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

export async function createWorkspaceImpl(
  token: string,
  input: { name: string; memberIds?: string[] },
) {
  const parsed = CreateWorkspaceInput.parse(input);
  const ownerId = decodeSub(token);
  return dbAsUser(token, async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({ name: parsed.name, ownerId })
      .returning();
    // Always insert the creator as owner.
    const memberRows: { workspaceId: string; userId: string; role: "owner" | "admin" | "member" }[] = [
      { workspaceId: ws.id, userId: ownerId, role: "owner" },
    ];
    // Append selected members (skip if they are the creator to avoid dupe).
    for (const uid of parsed.memberIds) {
      if (uid !== ownerId) {
        memberRows.push({ workspaceId: ws.id, userId: uid, role: "member" });
      }
    }
    await tx.insert(workspaceMembers).values(memberRows);
    return ws;
  });
}

export async function renameWorkspaceImpl(
  token: string,
  input: { id: string; name: string },
) {
  const parsed = RenameWorkspaceInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [ws] = await tx
      .update(workspaces)
      .set({ name: parsed.name })
      .where(eq(workspaces.id, parsed.id))
      .returning();
    if (!ws) throw new Error("Forbidden");
    return ws;
  });
}

export async function deleteWorkspaceImpl(
  token: string,
  input: { id: string },
) {
  const parsed = DeleteWorkspaceInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const r = await tx
      .delete(workspaces)
      .where(eq(workspaces.id, parsed.id))
      .returning({ id: workspaces.id });
    if (r.length === 0) throw new Error("Forbidden");
  });
}

export async function createWorkspace(input: { name: string; memberIds?: string[] }) {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await createWorkspaceImpl(token, input);
  revalidatePath("/");
  return ws;
}

export async function renameWorkspace(input: { id: string; name: string }) {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await renameWorkspaceImpl(token, input);
  revalidatePath("/");
  revalidatePath(`/w/${ws.id}`);
  return ws;
}

export async function deleteWorkspace(input: { id: string }) {
  await requireUser();
  const token = (await getSessionToken())!;
  await deleteWorkspaceImpl(token, input);
  revalidatePath("/");
}

export async function setWorkspaceAutoAssignCreatorImpl(
  token: string,
  input: { id: string; autoAssignCreator: boolean },
) {
  const parsed = SetWorkspaceAutoAssignCreatorInput.parse(input);
  return dbAsUser(token, async (tx) => {
    const [ws] = await tx
      .update(workspaces)
      .set({ autoAssignCreator: parsed.autoAssignCreator })
      .where(eq(workspaces.id, parsed.id))
      .returning();
    if (!ws) throw new Error("Forbidden");
    return ws;
  });
}

export async function setWorkspaceAutoAssignCreator(input: {
  id: string;
  autoAssignCreator: boolean;
}) {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await setWorkspaceAutoAssignCreatorImpl(token, input);
  revalidatePath(`/w/${ws.id}/settings`);
  return ws;
}
