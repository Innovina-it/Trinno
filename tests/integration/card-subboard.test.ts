import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { boards, lists } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import {
  createBoardImpl,
  createSubboardImpl,
  promoteCardToSubboardImpl,
} from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl } from "@/actions/cards";
import { getBoardSnapshot } from "@/lib/queries/board-snapshot";

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

describe("card-as-subboard creation", () => {
  it("promoteCardToSubboardImpl creates a child board anchored to the card", async () => {
    const u = await makeUser("subboard-promote");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const parent = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Parent",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: parent.id, title: "L" });
    const card = await createCardImpl(u.jwt, { listId: l.id, title: "Anchor" });

    const sub = await promoteCardToSubboardImpl(u.jwt, { cardId: card.id });
    expect(sub.parentBoardId).toBe(parent.id);
    expect(sub.parentCardId).toBe(card.id);
    expect(sub.title).toBe("Anchor");
    expect(sub.workspaceId).toBe(ws.id);

    // Default lists were seeded.
    const seededLists = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(lists).where(eq(lists.boardId, sub.id)),
    );
    expect(seededLists.length).toBeGreaterThan(0);
  });

  it("getBoardSnapshot.cardSubboards surfaces the pointer to the parent kanban", async () => {
    const u = await makeUser("subboard-snapshot");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const parent = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Parent",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: parent.id, title: "L" });
    const card = await createCardImpl(u.jwt, { listId: l.id, title: "Anchor" });
    const sub = await promoteCardToSubboardImpl(u.jwt, { cardId: card.id });

    const snap = await getBoardSnapshot(u.jwt, parent.id);
    expect(snap).not.toBeNull();
    expect(snap!.cardSubboards).toEqual([
      { cardId: card.id, subBoardId: sub.id, title: "Anchor" },
    ]);
  });

  it("createSubboardImpl rejects an anchor card from a different board", async () => {
    const u = await makeUser("subboard-mismatch");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const a = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "A",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const lA = await createListImpl(u.jwt, { boardId: a.id, title: "L" });
    const cardOnA = await createCardImpl(u.jwt, { listId: lA.id, title: "X" });
    await expect(
      createSubboardImpl(u.jwt, {
        parentBoardId: b.id,
        parentCardId: cardOnA.id,
        title: "Bad",
      }),
    ).rejects.toThrow(/parent board/i);
  });

  it("promoting the same card twice violates the 1:1 unique index", async () => {
    const u = await makeUser("subboard-duplicate");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const parent = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "Parent",
      backgroundKind: "color", backgroundValue: "#fafafa",
    });
    const l = await createListImpl(u.jwt, { boardId: parent.id, title: "L" });
    const card = await createCardImpl(u.jwt, { listId: l.id, title: "Anchor" });

    await promoteCardToSubboardImpl(u.jwt, { cardId: card.id });
    await expect(
      promoteCardToSubboardImpl(u.jwt, { cardId: card.id }),
    ).rejects.toThrow();

    const subRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boards).where(eq(boards.parentCardId, card.id)),
    );
    expect(subRows).toHaveLength(1);
  });
});
