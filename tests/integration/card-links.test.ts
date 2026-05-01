import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cardLinks } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import { createCardLinkImpl, deleteCardLinkImpl } from "@/actions/card-links";

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
  const a = await createCardImpl(jwt, { listId: l.id, title: "A" });
  const c = await createCardImpl(jwt, { listId: l.id, title: "C" });
  return { b, a, c };
}

describe("card links", () => {
  it("creates a link and mirrors the inverse", async () => {
    const u = await makeUser("cl1");
    const { a, c } = await setup(u.jwt);
    await createCardLinkImpl(u.jwt, {
      fromCardId: a.id,
      toCardId: c.id,
      kind: "blocks",
    });
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLinks),
    );
    const blocks = rows.find(
      (r) =>
        r.kind === "blocks" && r.fromCardId === a.id && r.toCardId === c.id,
    );
    const inverse = rows.find(
      (r) =>
        r.kind === "is_blocked_by" &&
        r.fromCardId === c.id &&
        r.toCardId === a.id,
    );
    expect(blocks).toBeDefined();
    expect(inverse).toBeDefined();
  });

  it("relates_to mirrors itself", async () => {
    const u = await makeUser("cl2");
    const { a, c } = await setup(u.jwt);
    await createCardLinkImpl(u.jwt, {
      fromCardId: a.id,
      toCardId: c.id,
      kind: "relates_to",
    });
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLinks),
    );
    const ab = rows.find(
      (r) =>
        r.kind === "relates_to" &&
        r.fromCardId === a.id &&
        r.toCardId === c.id,
    );
    const ba = rows.find(
      (r) =>
        r.kind === "relates_to" &&
        r.fromCardId === c.id &&
        r.toCardId === a.id,
    );
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
  });

  it("delete removes both directions", async () => {
    const u = await makeUser("cl3");
    const { a, c } = await setup(u.jwt);
    const link = await createCardLinkImpl(u.jwt, {
      fromCardId: a.id,
      toCardId: c.id,
      kind: "blocks",
    });
    await deleteCardLinkImpl(u.jwt, { id: link.id });
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLinks),
    );
    expect(rows.length).toBe(0);
  });

  it("non-member cannot link cards", async () => {
    const owner = await makeUser("cl4");
    const other = await makeUser("cl4o");
    const { a, c } = await setup(owner.jwt);
    await expect(
      createCardLinkImpl(other.jwt, {
        fromCardId: a.id,
        toCardId: c.id,
        kind: "blocks",
      }),
    ).rejects.toThrow();
  });

  // Plan #16b-γ-D (#38) — cross-board linking.
  it("creates cross-board links and mirrors them on the other board", async () => {
    const u = await makeUser("cl5");
    // Two boards in same workspace so the user is a member of both.
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS-X" });
    const bA = await createBoardImpl(u.jwt, {
      workspaceId: ws.id,
      title: "A",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const bB = await createBoardImpl(u.jwt, {
      workspaceId: ws.id,
      title: "B",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const lA = await createListImpl(u.jwt, { boardId: bA.id, title: "L" });
    const lB = await createListImpl(u.jwt, { boardId: bB.id, title: "L" });
    const cardA = await createCardImpl(u.jwt, {
      listId: lA.id,
      title: "Frontend bug",
    });
    const cardB = await createCardImpl(u.jwt, {
      listId: lB.id,
      title: "Backend story",
    });

    await createCardLinkImpl(u.jwt, {
      fromCardId: cardA.id,
      toCardId: cardB.id,
      kind: "is_blocked_by",
    });

    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLinks),
    );
    // Forward link lives on board A (from-card's board)
    const fwd = rows.find(
      (r) =>
        r.fromCardId === cardA.id &&
        r.toCardId === cardB.id &&
        r.kind === "is_blocked_by",
    );
    expect(fwd).toBeDefined();
    expect(fwd?.boardId).toBe(bA.id);
    // Inverse mirror lives on board B
    const inv = rows.find(
      (r) =>
        r.fromCardId === cardB.id &&
        r.toCardId === cardA.id &&
        r.kind === "blocks",
    );
    expect(inv).toBeDefined();
    expect(inv?.boardId).toBe(bB.id);
  });
});
