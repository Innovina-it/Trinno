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
  return { b, l1 };
}

const D1 = "2026-01-05T00:00:00.000Z";
const D2 = "2026-01-12T00:00:00.000Z";
const D3 = "2026-01-20T00:00:00.000Z";
const D4 = "2026-02-01T00:00:00.000Z";

describe("owner_id + epic date rollup", () => {
  it("persists owner_id and clears it on null", async () => {
    const u = await makeUser("ow");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l1.id, title: "X" });
    expect(c.ownerId).toBeNull();

    await updateCardImpl(u.jwt, { id: c.id, ownerId: u.id });
    const [withOwner] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)));
    expect(withOwner.ownerId).toBe(u.id);

    await updateCardImpl(u.jwt, { id: c.id, ownerId: null });
    const [cleared] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)));
    expect(cleared.ownerId).toBeNull();
  });

  it("subtask inherits parent dates when own dates blank", async () => {
    const u = await makeUser("inh");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const epic = await createCardImpl(u.jwt, {
      listId: l1.id, title: "Epic",
      startDate: D1, targetDate: D3,
    });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const child = await createCardImpl(u.jwt, {
      listId: l1.id, title: "Sub", parentCardId: epic.id,
    });
    expect(child.startDate?.toISOString()).toBe(D1);
    expect(child.targetDate?.toISOString()).toBe(D3);
  });

  it("epic span extends to encompass child dates", async () => {
    const u = await makeUser("rollup");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const epic = await createCardImpl(u.jwt, {
      listId: l1.id, title: "Epic",
      startDate: D2, targetDate: D3,
    });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });

    // Child outside the epic's span on both ends → epic should expand.
    await createCardImpl(u.jwt, {
      listId: l1.id, title: "Early", parentCardId: epic.id,
      startDate: D1, targetDate: D2,
    });
    await createCardImpl(u.jwt, {
      listId: l1.id, title: "Late", parentCardId: epic.id,
      startDate: D3, targetDate: D4,
    });

    const [parent] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, epic.id)));
    expect(parent.startDate?.toISOString()).toBe(D1);
    expect(parent.targetDate?.toISOString()).toBe(D4);
  });

  it("rollup never shrinks an epic's manual span", async () => {
    const u = await makeUser("noshrink");
    const { l1 } = await setupBoardWithLists(u.jwt);
    const epic = await createCardImpl(u.jwt, {
      listId: l1.id, title: "Epic",
      startDate: D1, targetDate: D4,
    });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });

    // Child entirely inside parent span → parent must NOT shrink.
    await createCardImpl(u.jwt, {
      listId: l1.id, title: "Inside", parentCardId: epic.id,
      startDate: D2, targetDate: D3,
    });

    const [parent] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, epic.id)));
    expect(parent.startDate?.toISOString()).toBe(D1);
    expect(parent.targetDate?.toISOString()).toBe(D4);
  });
});
