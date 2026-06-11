import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaceMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import {
  inviteMemberImpl, inviteMemberByUserIdImpl, changeMemberRoleImpl, removeMemberImpl,
} from "@/actions/workspace-members";

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
  return { id: data.user!.id, jwt: s.session!.access_token, email };
}

describe("workspace member actions (impl)", () => {
  it("invite + change role + remove", async () => {
    const owner = await makeUser("wm-o");
    const guest = await makeUser("wm-g");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Team" });

    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id, email: guest.email, role: "member",
    });
    let rows = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, guest.id),
      ))
    );
    expect(rows[0].role).toBe("member");

    await changeMemberRoleImpl(owner.jwt, {
      workspaceId: ws.id, userId: guest.id, role: "admin",
    });
    rows = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, guest.id),
      ))
    );
    expect(rows[0].role).toBe("admin");

    await removeMemberImpl(owner.jwt, { workspaceId: ws.id, userId: guest.id });
    rows = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, guest.id),
      ))
    );
    expect(rows.length).toBe(0);
  });

  it("non-admin cannot invite", async () => {
    const owner = await makeUser("wm-o2");
    const guest = await makeUser("wm-g2");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "Locked" });
    await inviteMemberImpl(owner.jwt, {
      workspaceId: ws.id, email: guest.email, role: "member",
    });
    const stranger = await makeUser("wm-s");
    await expect(inviteMemberImpl(guest.jwt, {
      workspaceId: ws.id, email: stranger.email, role: "member",
    })).rejects.toThrow();
  });

  it("invite by userId (picked from the suggestion dropdown)", async () => {
    const owner = await makeUser("wm-uid-o");
    const guest = await makeUser("wm-uid-g");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "ById" });

    const res = await inviteMemberByUserIdImpl(owner.jwt, {
      workspaceId: ws.id, userId: guest.id, role: "member",
    });
    // Confirmed account → resolved to email + direct-added, same as typing it.
    expect(res.kind).toBe("added");

    const rows = await dbAsUser(owner.jwt, async (tx) =>
      tx.select().from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, ws.id),
        eq(workspaceMembers.userId, guest.id),
      ))
    );
    expect(rows[0].role).toBe("member");
  });

  it("non-admin cannot invite by userId", async () => {
    const owner = await makeUser("wm-uid-o2");
    const member = await makeUser("wm-uid-m2");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "ByIdLocked" });
    await inviteMemberByUserIdImpl(owner.jwt, {
      workspaceId: ws.id, userId: member.id, role: "member",
    });
    const stranger = await makeUser("wm-uid-s2");
    await expect(inviteMemberByUserIdImpl(member.jwt, {
      workspaceId: ws.id, userId: stranger.id, role: "member",
    })).rejects.toThrow();
  });
});
