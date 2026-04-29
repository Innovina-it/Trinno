import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces, workspaceMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  createWorkspaceImpl, deleteWorkspaceImpl,
} from "@/actions/workspaces";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("workspace actions (impl)", () => {
  it("createWorkspaceImpl creates a workspace owned by the caller", async () => {
    const u = await makeUser("ws-c");
    const ws = await createWorkspaceImpl(u.jwt, { name: "Project X" });
    expect(ws.name).toBe("Project X");
    expect(ws.ownerId).toBe(u.id);

    const m = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, ws.id),
            eq(workspaceMembers.userId, u.id))
      ));
    expect(m[0].role).toBe("owner");
  });

  it("deleteWorkspaceImpl removes the workspace for owner", async () => {
    const u = await makeUser("ws-d");
    const ws = await createWorkspaceImpl(u.jwt, { name: "ToDelete" });
    await deleteWorkspaceImpl(u.jwt, { id: ws.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(workspaces).where(eq(workspaces.id, ws.id))
    );
    expect(after.length).toBe(0);
  });

  it("non-owner cannot delete workspace", async () => {
    const owner = await makeUser("ws-o");
    const other = await makeUser("ws-x");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Locked" });
    await expect(deleteWorkspaceImpl(other.jwt, { id: ws.id })).rejects.toThrow();
    const stillThere = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaces).where(eq(workspaces.id, ws.id))
    );
    expect(stillThere.length).toBe(1);
  });
});
