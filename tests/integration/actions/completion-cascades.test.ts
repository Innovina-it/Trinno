import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import {
  createCardImpl,
  updateCardImpl,
  archiveCardImpl,
} from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 6)}@x.io`;
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

async function setupBoardWithLists(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#000",
  });
  const l1 = await createListImpl(jwt, { boardId: b.id, title: "L1" });
  return { ws, b, l1 };
}

async function readCard(jwt: string, id: string) {
  const [row] = await dbAsUser(jwt, async (tx) =>
    tx.select().from(cards).where(eq(cards.id, id)),
  );
  return row;
}

describe("subtask → parent autocomplete cascade", () => {
  it("flips parent's completed_at only when the LAST open child completes", async () => {
    const u = await makeUser("cc-all");
    const { l1 } = await setupBoardWithLists(u.jwt);

    const epic = await createCardImpl(u.jwt, { listId: l1.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });

    const c1 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C1",
      parentCardId: epic.id,
    });
    const c2 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C2",
      parentCardId: epic.id,
    });
    const c3 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C3",
      parentCardId: epic.id,
    });

    // Complete two of three children — parent should still be open.
    await updateCardImpl(u.jwt, { id: c1.id, completed: true });
    await updateCardImpl(u.jwt, { id: c2.id, completed: true });
    expect((await readCard(u.jwt, epic.id)).completedAt).toBeNull();

    // Last child flips → parent autocompletes.
    await updateCardImpl(u.jwt, { id: c3.id, completed: true });
    expect((await readCard(u.jwt, epic.id)).completedAt).not.toBeNull();
  });

  it("does NOT auto-uncomplete the parent when a child is un-checked", async () => {
    const u = await makeUser("cc-no-undo");
    const { l1 } = await setupBoardWithLists(u.jwt);

    const epic = await createCardImpl(u.jwt, { listId: l1.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const c1 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C1",
      parentCardId: epic.id,
    });
    const c2 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C2",
      parentCardId: epic.id,
    });
    const c3 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C3",
      parentCardId: epic.id,
    });

    await updateCardImpl(u.jwt, { id: c1.id, completed: true });
    await updateCardImpl(u.jwt, { id: c2.id, completed: true });
    await updateCardImpl(u.jwt, { id: c3.id, completed: true });
    const completed = (await readCard(u.jwt, epic.id)).completedAt;
    expect(completed).not.toBeNull();

    // Un-check one child — parent must keep its completed_at exactly.
    await updateCardImpl(u.jwt, { id: c1.id, completed: false });
    const after = await readCard(u.jwt, epic.id);
    expect(after.completedAt).not.toBeNull();
    // Same instant as before — no cascade re-write of the parent's stamp.
    expect(after.completedAt!.toString()).toBe(completed!.toString());
  });

  it("ignores archived children when deciding 'all done'", async () => {
    const u = await makeUser("cc-arch");
    const { l1 } = await setupBoardWithLists(u.jwt);

    const epic = await createCardImpl(u.jwt, { listId: l1.id, title: "Epic" });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });
    const c1 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C1",
      parentCardId: epic.id,
    });
    const c2 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C2",
      parentCardId: epic.id,
    });
    const c3 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C3-archived",
      parentCardId: epic.id,
    });

    // Archive c3 — it should drop out of the "all done" tally entirely.
    await archiveCardImpl(u.jwt, { id: c3.id, archived: true });

    // Completing the two non-archived children should be enough.
    await updateCardImpl(u.jwt, { id: c1.id, completed: true });
    expect((await readCard(u.jwt, epic.id)).completedAt).toBeNull();

    await updateCardImpl(u.jwt, { id: c2.id, completed: true });
    expect((await readCard(u.jwt, epic.id)).completedAt).not.toBeNull();
    // Archived child stays uncompleted — we never touched it.
    expect((await readCard(u.jwt, c3.id)).completedAt).toBeNull();
  });
});
