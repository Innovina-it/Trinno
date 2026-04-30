import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setWipLimitImpl } from "@/actions/lists";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2,6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon)
    .auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { l };
}

describe("list wip_limit", () => {
  it("sets and clears a wip limit", async () => {
    const u = await makeUser("wip1");
    const { l } = await setup(u.jwt);
    const updated = await setWipLimitImpl(u.jwt, { id: l.id, wipLimit: 3 });
    expect((updated as { wipLimit?: number | null }).wipLimit).toBe(3);
    const cleared = await setWipLimitImpl(u.jwt, { id: l.id, wipLimit: null });
    expect((cleared as { wipLimit?: number | null }).wipLimit).toBeNull();
  });

  it("rejects out-of-range wip limit", async () => {
    const u = await makeUser("wip2");
    const { l } = await setup(u.jwt);
    await expect(setWipLimitImpl(u.jwt, { id: l.id, wipLimit: 0 })).rejects.toThrow();
    await expect(setWipLimitImpl(u.jwt, { id: l.id, wipLimit: 9999 })).rejects.toThrow();
  });

  it("non-member cannot set wip limit", async () => {
    const owner = await makeUser("wip3");
    const other = await makeUser("wip3o");
    const { l } = await setup(owner.jwt);
    await expect(setWipLimitImpl(other.jwt, { id: l.id, wipLimit: 5 })).rejects.toThrow();
  });
});
