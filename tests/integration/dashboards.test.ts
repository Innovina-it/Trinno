import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { gadgets } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import {
  createDashboardImpl,
  deleteDashboardImpl,
} from "@/actions/dashboards";
import {
  createGadgetImpl,
  removeGadgetImpl,
  moveGadgetImpl,
} from "@/actions/gadgets";
import { listDashboards } from "@/lib/queries/dashboards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email,
    password: "passw0rd!",
    email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email,
    password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("dashboards + gadgets", () => {
  it("personal dashboard create + list returns it for owner", async () => {
    const u = await makeUser("dsh1");
    const d = await createDashboardImpl(u.jwt, {
      name: "Personal A",
      scope: "personal",
    });
    expect(d.scope).toBe("personal");
    expect(d.workspaceId).toBeNull();

    const list = await listDashboards(u.jwt);
    expect(list.find((x) => x.id === d.id)?.name).toBe("Personal A");
  });

  it("workspace dashboard visible to other workspace members", async () => {
    const owner = await makeUser("dsh2o");
    const member = await makeUser("dsh2m");
    const ws = await createWorkspaceImpl(owner.jwt, { name: "WS shared" });
    // Add `member` to the workspace via service-role.
    const ins = await service
      .from("workspace_members")
      .insert({ workspace_id: ws.id, user_id: member.id, role: "member" });
    expect(ins.error).toBeNull();

    const d = await createDashboardImpl(owner.jwt, {
      name: "Team Health",
      scope: "workspace",
      workspaceId: ws.id,
    });
    expect(d.scope).toBe("workspace");

    const list = await listDashboards(member.jwt);
    expect(list.find((x) => x.id === d.id)?.name).toBe("Team Health");
  });

  it("personal dashboard NOT visible to other users", async () => {
    const owner = await makeUser("dsh3o");
    const stranger = await makeUser("dsh3s");
    const d = await createDashboardImpl(owner.jwt, {
      name: "Private",
      scope: "personal",
    });
    const list = await listDashboards(stranger.jwt);
    expect(list.find((x) => x.id === d.id)).toBeUndefined();
  });

  it("add + move + delete gadget", async () => {
    const u = await makeUser("dsh4");
    const d = await createDashboardImpl(u.jwt, {
      name: "G",
      scope: "personal",
    });
    const g1 = await createGadgetImpl(u.jwt, {
      dashboardId: d.id,
      type: "markdown_note",
      config: { body: "first" },
    });
    const g2 = await createGadgetImpl(u.jwt, {
      dashboardId: d.id,
      type: "markdown_note",
      config: { body: "second" },
    });
    const g3 = await createGadgetImpl(u.jwt, {
      dashboardId: d.id,
      type: "markdown_note",
      config: { body: "third" },
    });
    expect(g1.position).toBe(0);
    expect(g2.position).toBe(1);
    expect(g3.position).toBe(2);

    // Move g2 up — should swap with g1.
    await moveGadgetImpl(u.jwt, { id: g2.id, direction: "up" });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(gadgets)
        .where(eq(gadgets.dashboardId, d.id))
        .orderBy(asc(gadgets.position)),
    );
    expect(after.map((g) => g.id)).toEqual([g2.id, g1.id, g3.id]);

    await removeGadgetImpl(u.jwt, { id: g1.id });
    const final = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(gadgets)
        .where(eq(gadgets.dashboardId, d.id))
        .orderBy(asc(gadgets.position)),
    );
    expect(final.map((g) => g.id)).toEqual([g2.id, g3.id]);
  });

  it("non-owner cannot delete dashboard", async () => {
    const owner = await makeUser("dsh5o");
    const stranger = await makeUser("dsh5s");
    const d = await createDashboardImpl(owner.jwt, {
      name: "Mine",
      scope: "personal",
    });
    await expect(
      deleteDashboardImpl(stranger.jwt, { id: d.id }),
    ).rejects.toThrow();
    // Confirm still exists for owner.
    const list = await listDashboards(owner.jwt);
    expect(list.find((x) => x.id === d.id)).toBeTruthy();
  });
});
