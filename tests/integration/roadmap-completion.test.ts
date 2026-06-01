import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { lists, cards } from "@/lib/db/schema";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setListStatusKindImpl, deleteListImpl } from "@/actions/lists";
import {
  createCardImpl,
  moveCardImpl,
  updateCardImpl,
  bulkSetCompletedImpl,
  setRoadmapCompletionImpl,
} from "@/actions/cards";

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

async function makeBoard(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id, title: "B",
    backgroundKind: "color", backgroundValue: "#fafafa",
    // No default Todo/In Progress/Done lists — the tests create exactly the
    // status lists each case needs. A unique (board_id, status_kind) index
    // (lists_board_id_status_kind_uq) forbids two lists sharing a status, so
    // seeding defaults here would collide with the lists we set up below.
    seedDefaultLists: false,
  });
  return b;
}

async function readCard(jwt: string, id: string) {
  const [c] = await dbAsUser(jwt, async (tx) =>
    tx.select().from(cards).where(eq(cards.id, id)),
  );
  return c;
}

async function statusKindOf(jwt: string, listId: string) {
  const [l] = await dbAsUser(jwt, async (tx) =>
    tx.select({ statusKind: lists.statusKind }).from(lists).where(eq(lists.id, listId)),
  );
  return l?.statusKind ?? null;
}

describe("setRoadmapCompletionImpl", () => {
  it("complete: moves card to done list and records pre_done_list_id", async () => {
    const u = await makeUser("rc-1");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });

    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).not.toBeNull();
    expect(card.preDoneListId).toBe(todo.id);
    expect(card.listId).toBe(r.listId);
    expect(await statusKindOf(u.jwt, card.listId)).toBe("done");
  });

  it("complete then un-complete: returns card to prior list, clears pointer + completedAt", async () => {
    const u = await makeUser("rc-2");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });

    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).toBeNull();
    expect(card.preDoneListId).toBeNull();
    expect(card.listId).toBe(todo.id);
  });

  it("complete with no done list on board: creates one and moves card", async () => {
    const u = await makeUser("rc-3");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });

    expect(r.listId).not.toBe(todo.id);
    expect(await statusKindOf(u.jwt, r.listId)).toBe("done");
    const allDone = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(lists).where(and(eq(lists.boardId, b.id), eq(lists.statusKind, "done"))),
    );
    expect(allDone).toHaveLength(1);
  });

  it("complete a card already in a done list: no move, pre_done_list_id stays null", async () => {
    const u = await makeUser("rc-4");
    const b = await makeBoard(u.jwt);
    const done = await createListImpl(u.jwt, { boardId: b.id, title: "Done" });
    await setListStatusKindImpl(u.jwt, { id: done.id, statusKind: "done" });
    const c = await createCardImpl(u.jwt, { listId: done.id, title: "C" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });

    expect(r.listId).toBe(done.id);
    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).not.toBeNull();
    expect(card.preDoneListId).toBeNull();

    const r2 = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });
    expect(r2.listId).toBe(done.id);
    const card2 = await readCard(u.jwt, c.id);
    expect(card2.completedAt).toBeNull();
  });

  it("manual move out of done while completed, then un-complete: does NOT yank card back", async () => {
    const u = await makeUser("rc-5");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const other = await createListImpl(u.jwt, { boardId: b.id, title: "Doing" });
    await setListStatusKindImpl(u.jwt, { id: other.id, statusKind: "in_progress" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    await moveCardImpl(u.jwt, { id: c.id, listId: other.id, position: "n" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });

    expect(r.listId).toBe(other.id);
    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).toBeNull();
    expect(card.preDoneListId).toBeNull();
  });

  it("INT-09: source list with no status_kind — complete moves to done, un-complete returns to it", async () => {
    const u = await makeUser("rc-9");
    const b = await makeBoard(u.jwt);
    // No setListStatusKind → status_kind stays null (unmapped / backlog-style).
    const backlog = await createListImpl(u.jwt, { boardId: b.id, title: "Backlog" });
    const c = await createCardImpl(u.jwt, { listId: backlog.id, title: "C" });

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    let card = await readCard(u.jwt, c.id);
    expect(card.preDoneListId).toBe(backlog.id);
    expect(await statusKindOf(u.jwt, card.listId)).toBe("done");

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });
    card = await readCard(u.jwt, c.id);
    expect(card.listId).toBe(backlog.id);
    expect(card.preDoneListId).toBeNull();
  });

  it("INT-12: repeated complete/un-complete cycles end in the original list with a clean pointer", async () => {
    const u = await makeUser("rc-12");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    for (let i = 0; i < 2; i += 1) {
      await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
      const done = await readCard(u.jwt, c.id);
      expect(await statusKindOf(u.jwt, done.listId)).toBe("done");
      expect(done.preDoneListId).toBe(todo.id);

      await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });
      const back = await readCard(u.jwt, c.id);
      expect(back.listId).toBe(todo.id);
      expect(back.preDoneListId).toBeNull();
      expect(back.completedAt).toBeNull();
    }
  });

  it("INT-13: prior list deleted before un-complete — card stays in done, pointer FK-nulled, no throw", async () => {
    const u = await makeUser("rc-13");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    const r = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    const doneListId = r.listId;

    // The card moved out of `todo` into `done`, so `todo` is now empty and
    // safe to delete. The FK cards.pre_done_list_id -> lists ON DELETE SET NULL
    // should null the stored pointer.
    await deleteListImpl(u.jwt, { id: todo.id });
    expect((await readCard(u.jwt, c.id)).preDoneListId).toBeNull();

    const r2 = await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });
    expect(r2.listId).toBe(doneListId); // stayed in done (nothing to revert to)
    expect((await readCard(u.jwt, c.id)).completedAt).toBeNull();
  });

  it("INT-17: due_complete mirror (trigger 0062) tracks completion through the roadmap toggle", async () => {
    const u = await makeUser("rc-17");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: true });
    expect((await readCard(u.jwt, c.id)).dueComplete).toBe(true);

    await setRoadmapCompletionImpl(u.jwt, { cardId: c.id, completed: false });
    expect((await readCard(u.jwt, c.id)).dueComplete).toBe(false);
  });
});

describe("scope guard — board-side completion must NOT move the card", () => {
  it("REGR-01: updateCard({completed}) sets completion but never touches listId", async () => {
    const u = await makeUser("rg-1");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    await updateCardImpl(u.jwt, { id: c.id, completed: true });
    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).not.toBeNull();
    expect(card.listId).toBe(todo.id); // NOT moved to a done list
    expect(card.preDoneListId).toBeNull(); // no pointer recorded
  });

  it("REGR-04: bulkSetCompleted sets completion but does not move cards", async () => {
    const u = await makeUser("rg-4");
    const b = await makeBoard(u.jwt);
    const todo = await createListImpl(u.jwt, { boardId: b.id, title: "Todo" });
    await setListStatusKindImpl(u.jwt, { id: todo.id, statusKind: "todo" });
    const c = await createCardImpl(u.jwt, { listId: todo.id, title: "C" });

    await bulkSetCompletedImpl(u.jwt, { cardIds: [c.id], completed: true });
    const card = await readCard(u.jwt, c.id);
    expect(card.completedAt).not.toBeNull();
    expect(card.listId).toBe(todo.id);
    expect(card.preDoneListId).toBeNull();
  });
});
