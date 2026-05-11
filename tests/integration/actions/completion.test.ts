import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

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

async function setupBoardWithLists(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#000",
  });
  const l1 = await createListImpl(jwt, { boardId: b.id, title: "L1" });
  return { l1 };
}

describe("card completion (completed_at + dueComplete sync)", () => {
  it("completed=true sets completedAt and mirrors dueComplete=true", async () => {
    const u = await makeUser("comp1");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l1.id, title: "X" });
    expect(c.completedAt).toBeNull();
    expect(c.dueComplete).toBe(false);

    await updateCardImpl(u.jwt, { id: c.id, completed: true });
    const [done] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)));
    expect(done.completedAt).not.toBeNull();
    expect(done.dueComplete).toBe(true);

    await updateCardImpl(u.jwt, { id: c.id, completed: false });
    const [open] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)));
    expect(open.completedAt).toBeNull();
    expect(open.dueComplete).toBe(false);
  });

  it("legacy dueComplete=true also stamps completedAt via trigger", async () => {
    const u = await makeUser("comp2");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l1.id, title: "Y" });
    await updateCardImpl(u.jwt, { id: c.id, dueComplete: true });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)));
    expect(row.completedAt).not.toBeNull();
    expect(row.dueComplete).toBe(true);
  });
});
