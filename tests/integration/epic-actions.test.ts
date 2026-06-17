import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { lists, cards } from "@/lib/db/schema";
import { ensureStatusListImpl } from "@/actions/lists";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setListStatusKindImpl } from "@/actions/lists";
import { createCardImpl, moveCardToStatusImpl } from "@/actions/cards";

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

describe("ensureStatusListImpl", () => {
  it("returns existing status list when one already maps the status_kind", async () => {
    const u = await makeUser("ensure-1");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
      // Empty board: these tests manage their own status_kind columns, so the
      // default Todo/In Progress/Done seed would collide with the
      // (board_id, status_kind) unique index (migration 0054).
      seedDefaultLists: false,
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "Done col" });
    await setListStatusKindImpl(u.jwt, { id: l.id, statusKind: "done" });

    const r = await ensureStatusListImpl(u.jwt, {
      boardId: b.id, statusKind: "done",
    });
    expect(r.id).toBe(l.id);
  });

  it("creates a new list when no list maps the status_kind", async () => {
    const u = await makeUser("ensure-2");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
      // Empty board: these tests manage their own status_kind columns, so the
      // default Todo/In Progress/Done seed would collide with the
      // (board_id, status_kind) unique index (migration 0054).
      seedDefaultLists: false,
    });
    const r = await ensureStatusListImpl(u.jwt, {
      boardId: b.id, statusKind: "in_progress",
    });
    expect(r.boardId).toBe(b.id);
    expect(r.statusKind).toBe("in_progress");
    expect(r.title.toLowerCase()).toContain("progress");

    // Idempotent: second call returns the same list, no new row.
    const r2 = await ensureStatusListImpl(u.jwt, {
      boardId: b.id, statusKind: "in_progress",
    });
    expect(r2.id).toBe(r.id);

    const allInProgress = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(and(eq(lists.boardId, b.id), eq(lists.statusKind, "in_progress"))),
    );
    expect(allInProgress).toHaveLength(1);
  });

  it("survives a concurrent call: only one list created per (board, status)", async () => {
    const u = await makeUser("ensure-race");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
      // Empty board: these tests manage their own status_kind columns, so the
      // default Todo/In Progress/Done seed would collide with the
      // (board_id, status_kind) unique index (migration 0054).
      seedDefaultLists: false,
    });
    // Fire 5 concurrent calls for the same (board, status). They must
    // all return the same list id, and the DB must contain exactly one
    // row matching that (board, status).
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ensureStatusListImpl(u.jwt, { boardId: b.id, statusKind: "review" }),
      ),
    );
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);

    const allReview = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(and(eq(lists.boardId, b.id), eq(lists.statusKind, "review"))),
    );
    expect(allReview).toHaveLength(1);
  });
});

describe("moveCardToStatusImpl", () => {
  it("moves the card into a list with matching status_kind on its current board", async () => {
    const u = await makeUser("move-status-1");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
      // Empty board: these tests manage their own status_kind columns, so the
      // default Todo/In Progress/Done seed would collide with the
      // (board_id, status_kind) unique index (migration 0054).
      seedDefaultLists: false,
    });
    const lTodo = await createListImpl(u.jwt, { boardId: b.id, title: "T" });
    await setListStatusKindImpl(u.jwt, { id: lTodo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: lTodo.id, title: "C" });

    const r = await moveCardToStatusImpl(u.jwt, {
      cardId: c.id, statusKind: "done",
    });

    // Auto-created a "done" list, then moved card.
    const [card] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(card.listId).toBe(r.listId);
    const [doneList] = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(and(eq(lists.boardId, b.id), eq(lists.statusKind, "done"))),
    );
    expect(doneList.id).toBe(r.listId);
  });

  it("is a no-op when the card already lives in a list with that status_kind", async () => {
    const u = await makeUser("move-status-2");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
      // Empty board: these tests manage their own status_kind columns, so the
      // default Todo/In Progress/Done seed would collide with the
      // (board_id, status_kind) unique index (migration 0054).
      seedDefaultLists: false,
    });
    const l = await createListImpl(u.jwt, { boardId: b.id, title: "Done" });
    await setListStatusKindImpl(u.jwt, { id: l.id, statusKind: "done" });
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "C" });

    const r = await moveCardToStatusImpl(u.jwt, {
      cardId: c.id, statusKind: "done",
    });
    expect(r.listId).toBe(l.id);
  });

  it("moves a card from a 'todo' list to an existing 'done' list (does not create new column)", async () => {
    const u = await makeUser("move-status-3");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const b = await createBoardImpl(u.jwt, {
      workspaceId: ws.id, title: "B",
      backgroundKind: "color", backgroundValue: "#fafafa",
      // Empty board: these tests manage their own status_kind columns, so the
      // default Todo/In Progress/Done seed would collide with the
      // (board_id, status_kind) unique index (migration 0054).
      seedDefaultLists: false,
    });
    const lTodo = await createListImpl(u.jwt, { boardId: b.id, title: "T" });
    await setListStatusKindImpl(u.jwt, { id: lTodo.id, statusKind: "todo" });
    const lDone = await createListImpl(u.jwt, { boardId: b.id, title: "D" });
    await setListStatusKindImpl(u.jwt, { id: lDone.id, statusKind: "done" });
    const c = await createCardImpl(u.jwt, { listId: lTodo.id, title: "C" });

    const r = await moveCardToStatusImpl(u.jwt, {
      cardId: c.id, statusKind: "done",
    });
    expect(r.listId).toBe(lDone.id);

    // Source list should now be empty.
    const sourceCards = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.listId, lTodo.id)),
    );
    expect(sourceCards).toHaveLength(0);

    // Destination list should have exactly the moved card.
    const destCards = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.listId, lDone.id)),
    );
    expect(destCards.map((x) => x.id)).toEqual([c.id]);
  });
});
