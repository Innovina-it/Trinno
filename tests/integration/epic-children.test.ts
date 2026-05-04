import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { listEpicChildren } from "@/lib/queries/epic-children";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({
    email, password: "passw0rd!", email_confirm: true,
  });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({
    email, password: "passw0rd!",
  });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

describe("listEpicChildren", () => {
  it("returns only direct children of the epic + the epic's lists", async () => {
    const u = await makeUser("epic-children");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "L" });
    const epic = await createCardImpl(u.jwt, { listId: l.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });

    const c1 = await createCardImpl(u.jwt, { listId: l.id, title: "Child 1" });
    const c2 = await createCardImpl(u.jwt, { listId: l.id, title: "Child 2" });
    await updateCardImpl(u.jwt, { id: c1.id, parentCardId: epic.id });
    await updateCardImpl(u.jwt, { id: c2.id, parentCardId: epic.id });

    // Grandchild — must NOT be in the result.
    const gc = await createCardImpl(u.jwt, { listId: l.id, title: "GC" });
    await updateCardImpl(u.jwt, { id: gc.id, parentCardId: c1.id });

    const result = await listEpicChildren(u.jwt, epic.id);
    expect(result).not.toBeNull();
    expect(result!.epic.id).toBe(epic.id);
    expect(result!.epic.boardId).toBe(b.id);
    expect(result!.children.map((c) => c.id).sort()).toEqual(
      [c1.id, c2.id].sort(),
    );
    expect(result!.lists.map((x) => x.id)).toContain(l.id);
  });

  it("returns null for non-existent or non-epic ids", async () => {
    const u = await makeUser("epic-children-null");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "L" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "Plain" });
    expect(await listEpicChildren(u.jwt, c.id)).toBeNull();
    expect(
      await listEpicChildren(u.jwt, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
