import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import {
  createSprintImpl,
  startSprintImpl,
  completeSprintImpl,
  assignCardToSprintImpl,
  deleteSprintImpl,
} from "@/actions/sprints";

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

describe("sprints", () => {
  it("creates and deletes a planned sprint", async () => {
    const u = await makeUser("sp1");
    const { ws } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
    });
    expect(sp.state).toBe("planned");
    await deleteSprintImpl(u.jwt, { id: sp.id });
    const after = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(sprints).where(eq(sprints.id, sp.id)),
    );
    expect(after.length).toBe(0);
  });

  it("only one active sprint per workspace", async () => {
    const u = await makeUser("sp2");
    const { ws } = await setup(u.jwt);
    const a = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "A",
    });
    const b = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "B",
    });
    await startSprintImpl(u.jwt, { id: a.id });
    await expect(startSprintImpl(u.jwt, { id: b.id })).rejects.toThrow();
  });

  it("assigns + unassigns a card to a sprint", async () => {
    const u = await makeUser("sp3");
    const { ws, l } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S",
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });
    let row = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(row[0].sprintId).toBe(sp.id);
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: null });
    row = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(row[0].sprintId).toBeNull();
  });

  it("complete sprint moves remaining cards to backlog by default", async () => {
    const u = await makeUser("sp4");
    const { ws, l } = await setup(u.jwt);
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S",
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });
    await startSprintImpl(u.jwt, { id: sp.id });
    await completeSprintImpl(u.jwt, { id: sp.id, carryoverTo: "backlog" });
    const row = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(row[0].sprintId).toBeNull();
    const sprintRow = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(sprints).where(eq(sprints.id, sp.id)),
    );
    expect(sprintRow[0].state).toBe("completed");
  });

  it("rejects assigning a card to a sprint in another workspace", async () => {
    const u = await makeUser("sp5");
    const { l } = await setup(u.jwt);
    // Create a separate workspace + sprint
    const otherWs = await createWorkspaceImpl(u.jwt, { name: "Other" });
    const sp = await createSprintImpl(u.jwt, {
      workspaceId: otherWs.id,
      name: "Other-S",
    });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });
    await expect(
      assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id }),
    ).rejects.toThrow();
  });
});
