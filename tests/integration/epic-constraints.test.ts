import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
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

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#fafafa",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { ws, b, l };
}

describe("0051 epic constraints", () => {
  it("rejects setting an epic's parent to another epic", async () => {
    const u = await makeUser("epic-cycle");
    const { l } = await setup(u.jwt);
    const e1 = await createCardImpl(u.jwt, { listId: l.id, title: "E1" });
    const e2 = await createCardImpl(u.jwt, { listId: l.id, title: "E2" });
    await updateCardImpl(u.jwt, { id: e1.id, type: "epic" });
    await updateCardImpl(u.jwt, { id: e2.id, type: "epic" });
    let err: unknown;
    try {
      await updateCardImpl(u.jwt, { id: e2.id, parentCardId: e1.id });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // Drizzle wraps the postgres exception as "Failed query: ..." with the
    // original raise on .cause — same shape as the parent-cycle test in
    // card-types.test.ts. Match against the combined surface area.
    const e = err as { message: string; cause?: { message?: string } };
    const combined = `${e.message} ${e.cause?.message ?? ""}`;
    expect(combined).toMatch(/epic cannot have an epic as parent/i);
  });

  it("auto co-locates child to epic's home board on parent set", async () => {
    const u = await makeUser("epic-coloc");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const bA = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "A",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const bB = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const lA = await createListImpl(u.jwt, { boardId: bA.id, title: "L" });
    const lB = await createListImpl(u.jwt, { boardId: bB.id, title: "L" });
    const epic = await createCardImpl(u.jwt, { listId: lA.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const child = await createCardImpl(u.jwt, { listId: lB.id, title: "Child" });
    expect(child.boardId).toBe(bB.id);

    await updateCardImpl(u.jwt, { id: child.id, parentCardId: epic.id });
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, child.id)),
    );
    expect(row.boardId).toBe(bA.id); // co-located onto epic's board
  });

  it("rejects flipping a card to type=epic while it already has an epic child (parent-side type-flip)", async () => {
    const u = await makeUser("epic-flip");
    const { l } = await setup(u.jwt);
    const p = await createCardImpl(u.jwt, { listId: l.id, title: "P" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await updateCardImpl(u.jwt, { id: c.id, parentCardId: p.id });
    await updateCardImpl(u.jwt, { id: c.id, type: "epic" });
    // P is still type=task at this point. Flipping it to epic should fail
    // because C is already an epic with parent_card_id = P.id.
    let caught: unknown;
    try {
      await updateCardImpl(u.jwt, { id: p.id, type: "epic" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const err = caught as Error & { cause?: { message?: string } };
    const combined = `${err.message ?? ""} ${err.cause?.message ?? ""}`;
    expect(combined).toMatch(/epic cannot have an epic as parent/i);
  });

  it("backfill (0052): zero cross-board children of epics post-migration", async () => {
    // The 0052 backfill ran during db reset that created this test
    // environment. Combined with the 0051 BEFORE trigger, the schema
    // invariant is: no live row in cards has parent_card_id pointing at
    // an epic-typed card on a different board.
    const sqlClient = createClient(
      url,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await sqlClient.rpc("count_cross_board_epic_children");
    expect(error).toBeNull();
    expect(data).toBe(0);
  });

  it("0053: zero nested-epic-parent violations post-migration", async () => {
    const sqlClient = createClient(
      url,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await sqlClient.rpc("count_nested_epic_parents");
    expect(error).toBeNull();
    expect(data).toBe(0);
  });
});
