import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { boards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { listSubboardChildren } from "@/lib/queries/subboard-children";
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

describe("listSubboardChildren", () => {
  it("returns only top-level cards on the sub-board + the sub-board's lists", async () => {
    const u = await makeUser("subboard-children");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const parentBoard = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const subboard = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Sub-board",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    await dbAsUser(u.jwt, async (tx) =>
      tx
        .update(boards)
        .set({ parentBoardId: parentBoard.id })
        .where(eq(boards.id, subboard.id)),
    );
    const l = await createListImpl(u.jwt, { boardId: subboard.id, title: "L" });

    const c1 = await createCardImpl(u.jwt, { listId: l.id, title: "Child 1" });
    const c2 = await createCardImpl(u.jwt, { listId: l.id, title: "Child 2" });

    // Grandchild — must NOT be in the result.
    const gc = await createCardImpl(u.jwt, { listId: l.id, title: "GC" });
    await updateCardImpl(u.jwt, { id: gc.id, parentCardId: c1.id });

    const result = await listSubboardChildren(u.jwt, subboard.id);
    expect(result).not.toBeNull();
    expect(result!.subboard.id).toBe(subboard.id);
    expect(result!.subboard.parentBoardId).toBe(parentBoard.id);
    expect(result!.children.map((c) => c.id).sort()).toEqual(
      [c1.id, c2.id].sort(),
    );
    expect(result!.lists.map((x) => x.id)).toContain(l.id);
  });

  it("returns null for non-existent or non-sub-board ids", async () => {
    const u = await makeUser("subboard-children-null");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    expect(await listSubboardChildren(u.jwt, b.id)).toBeNull();
    expect(
      await listSubboardChildren(u.jwt, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
