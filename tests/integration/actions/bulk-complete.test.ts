import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import {
  createCardImpl,
  bulkSetCompletedImpl,
} from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@x.io`;
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

async function setupBoardWithLists(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#000",
  });
  const l1 = await createListImpl(jwt, { boardId: b.id, title: "L1" });
  return { ws, b, l1 };
}

describe("bulkSetCompletedImpl", () => {
  it("marks all cards complete and the trigger mirrors due_complete", async () => {
    const u = await makeUser("blk-cmp");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const c1 = await createCardImpl(u.jwt, { listId: l1.id, title: "A" });
    const c2 = await createCardImpl(u.jwt, { listId: l1.id, title: "B" });
    const c3 = await createCardImpl(u.jwt, { listId: l1.id, title: "C" });
    const ids = [c1.id, c2.id, c3.id];

    const r = await bulkSetCompletedImpl(u.jwt, {
      cardIds: ids,
      completed: true,
    });
    expect(r.updated).toBe(3);

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, ids)),
    );
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.completedAt).not.toBeNull();
      expect(row.dueComplete).toBe(true);
    }
  });

  it("partial un-complete leaves untouched cards completed", async () => {
    const u = await makeUser("blk-cmp-p");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const c1 = await createCardImpl(u.jwt, { listId: l1.id, title: "A" });
    const c2 = await createCardImpl(u.jwt, { listId: l1.id, title: "B" });
    const c3 = await createCardImpl(u.jwt, { listId: l1.id, title: "C" });
    const allIds = [c1.id, c2.id, c3.id];

    await bulkSetCompletedImpl(u.jwt, { cardIds: allIds, completed: true });
    const r = await bulkSetCompletedImpl(u.jwt, {
      cardIds: [c1.id, c2.id],
      completed: false,
    });
    expect(r.updated).toBe(2);

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, allIds)),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(c1.id)!.completedAt).toBeNull();
    expect(byId.get(c1.id)!.dueComplete).toBe(false);
    expect(byId.get(c2.id)!.completedAt).toBeNull();
    expect(byId.get(c2.id)!.dueComplete).toBe(false);
    expect(byId.get(c3.id)!.completedAt).not.toBeNull();
    expect(byId.get(c3.id)!.dueComplete).toBe(true);
  });

  it("rejects empty cardIds (zod min 1)", async () => {
    const u = await makeUser("blk-cmp-z");
    await expect(
      bulkSetCompletedImpl(u.jwt, { cardIds: [], completed: true }),
    ).rejects.toThrow();
  });
});
