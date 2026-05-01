import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, comments, checklists } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import {
  createCardImpl,
  moveCardCrossBoardImpl,
} from "@/actions/cards";
import { createChecklistImpl } from "@/actions/checklists";
import { createCommentImpl } from "@/actions/comments";

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

describe("moveCardCrossBoard (Plan #16b-γ-D #37)", () => {
  it("moves a card to a list on another board the user is admin of", async () => {
    const u = await makeUser("xmove1");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS-A" });
    const bSrc = await createBoardImpl(u.jwt, {
      workspaceId: ws.id,
      title: "Source",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const bDst = await createBoardImpl(u.jwt, {
      workspaceId: ws.id,
      title: "Dest",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const lSrc = await createListImpl(u.jwt, { boardId: bSrc.id, title: "L1" });
    const lDst = await createListImpl(u.jwt, { boardId: bDst.id, title: "L2" });
    const c = await createCardImpl(u.jwt, { listId: lSrc.id, title: "C" });

    const r = await moveCardCrossBoardImpl(u.jwt, {
      cardId: c.id,
      toListId: lDst.id,
    });
    expect(r.boardId).toBe(bDst.id);
    expect(r.listId).toBe(lDst.id);

    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(row.boardId).toBe(bDst.id);
    expect(row.listId).toBe(lDst.id);
  });

  it("rejects when the user is not a member of the destination board", async () => {
    const owner = await makeUser("xmove2-owner");
    const other = await makeUser("xmove2-other");

    // Owner has board A. Other has board B in a different workspace —
    // owner cannot read B's lists.
    const wsA = await createWorkspaceImpl(owner.jwt, { name: "WS-A" });
    const bA = await createBoardImpl(owner.jwt, {
      workspaceId: wsA.id,
      title: "Owner",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const lA = await createListImpl(owner.jwt, { boardId: bA.id, title: "L" });
    const cA = await createCardImpl(owner.jwt, {
      listId: lA.id,
      title: "C",
    });

    const wsB = await createWorkspaceImpl(other.jwt, { name: "WS-B" });
    const bB = await createBoardImpl(other.jwt, {
      workspaceId: wsB.id,
      title: "Other",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const lB = await createListImpl(other.jwt, { boardId: bB.id, title: "LB" });

    // Owner cannot read lB and so cannot move into it.
    await expect(
      moveCardCrossBoardImpl(owner.jwt, {
        cardId: cA.id,
        toListId: lB.id,
      }),
    ).rejects.toThrow();
  });

  it("re-denorms board_id on dependent rows (comments, checklists)", async () => {
    const u = await makeUser("xmove3");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const bSrc = await createBoardImpl(u.jwt, {
      workspaceId: ws.id,
      title: "Src",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const bDst = await createBoardImpl(u.jwt, {
      workspaceId: ws.id,
      title: "Dst",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
    });
    const lSrc = await createListImpl(u.jwt, { boardId: bSrc.id, title: "L" });
    const lDst = await createListImpl(u.jwt, { boardId: bDst.id, title: "L" });
    const c = await createCardImpl(u.jwt, { listId: lSrc.id, title: "C" });
    const checklist = await createChecklistImpl(u.jwt, {
      cardId: c.id,
      title: "Pre-flight",
    });
    const comment = await createCommentImpl(u.jwt, {
      cardId: c.id,
      body: "hello",
    });

    await moveCardCrossBoardImpl(u.jwt, {
      cardId: c.id,
      toListId: lDst.id,
    });

    // After the cross-board move, both the card and its child rows
    // (comments, checklists) should sit on the destination board.
    // Migration 0044 adds a cascade trigger on cards.board_id changes
    // that ripples through every denormed dependent table.
    const [card] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(card.boardId).toBe(bDst.id);

    const [chk] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(checklists).where(eq(checklists.id, checklist.id)),
    );
    const [cmt] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(comments).where(eq(comments.id, comment.id)),
    );
    expect(chk.boardId).toBe(bDst.id);
    expect(cmt.boardId).toBe(bDst.id);
  });
});
