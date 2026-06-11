import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, archiveCardImpl } from "@/actions/cards";
import { createSprintImpl } from "@/actions/sprints";
import { createComponentImpl } from "@/actions/components";
import { createVersionImpl } from "@/actions/versions";
import { getWorkspaceSnapshot } from "@/lib/queries/workspace-snapshot";

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
  return { id: data.user!.id, email, jwt: s.session!.access_token };
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

describe("getWorkspaceSnapshot", () => {
  it("returns boards + cards in the workspace", async () => {
    const u = await makeUser("ws-snap-1");
    const { ws, l } = await setup(u.jwt);
    await createCardImpl(u.jwt, { listId: l.id, title: "A" });
    await createCardImpl(u.jwt, { listId: l.id, title: "B" });
    await createCardImpl(u.jwt, { listId: l.id, title: "C" });

    const snap = await getWorkspaceSnapshot(u.jwt, ws.id);
    expect(snap.workspaceId).toBe(ws.id);
    expect(snap.boards.length).toBe(1);
    expect(snap.cards.length).toBe(3);
    expect(snap.cards.map((c) => c.title).sort()).toEqual(["A", "B", "C"]);
  });

  it("includes sprints, versions, components, and card_components", async () => {
    const u = await makeUser("ws-snap-2");
    const { ws, b, l } = await setup(u.jwt);
    const card = await createCardImpl(u.jwt, { listId: l.id, title: "Card" });
    await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "S1" });
    await createVersionImpl(u.jwt, { workspaceId: ws.id, name: "v1.0" });
    const comp = await createComponentImpl(u.jwt, {
      boardId: b.id,
      name: "API",
    });

    const snap = await getWorkspaceSnapshot(u.jwt, ws.id);
    expect(snap.sprints.length).toBe(1);
    expect(snap.sprints[0].name).toBe("S1");
    expect(snap.versions.length).toBe(1);
    expect(snap.versions[0].name).toBe("v1.0");
    expect(snap.components.length).toBe(1);
    expect(snap.components[0].name).toBe("API");
    // We didn't link the component to the card, so cardComponents stays empty.
    expect(snap.cardComponents.length).toBe(0);
    // The card itself is part of the snapshot.
    expect(snap.cards.find((c) => c.id === card.id)).toBeDefined();
    void comp;
  });

  it('variant "active" excludes archived cards; default keeps them', async () => {
    const u = await makeUser("ws-snap-4");
    const { ws, l } = await setup(u.jwt);
    await createCardImpl(u.jwt, { listId: l.id, title: "Live" });
    const gone = await createCardImpl(u.jwt, { listId: l.id, title: "Gone" });
    await archiveCardImpl(u.jwt, { id: gone.id, archived: true });

    const full = await getWorkspaceSnapshot(u.jwt, ws.id);
    expect(full.cards.map((c) => c.title).sort()).toEqual(["Gone", "Live"]);

    const active = await getWorkspaceSnapshot(u.jwt, ws.id, "active");
    expect(active.cards.map((c) => c.title)).toEqual(["Live"]);
    // Only the card rows are scoped — the rest of the snapshot is intact.
    expect(active.boards.length).toBe(full.boards.length);
    expect(active.lists.length).toBe(full.lists.length);
  });

  it("isolates workspaces — user B's snapshot of their own workspace excludes A's data", async () => {
    const a = await makeUser("ws-snap-3a");
    const b = await makeUser("ws-snap-3b");
    const { ws: wsA, l: lA } = await setup(a.jwt);
    await createCardImpl(a.jwt, { listId: lA.id, title: "A-only" });

    const { ws: wsB } = await setup(b.jwt);
    const snapB = await getWorkspaceSnapshot(b.jwt, wsB.id);
    expect(snapB.workspaceId).toBe(wsB.id);
    // B sees their own (empty) workspace, not A's card.
    expect(snapB.cards.map((c) => c.title)).not.toContain("A-only");
    // And asking for A's workspace as B should return no rows.
    const snapBofA = await getWorkspaceSnapshot(b.jwt, wsA.id);
    expect(snapBofA.boards.length).toBe(0);
    expect(snapBofA.cards.length).toBe(0);
  });
});
