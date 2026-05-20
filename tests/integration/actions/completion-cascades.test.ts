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

describe("subtask → parent autocomplete cascade (disabled — user-driven)", () => {
  // Auto-cascade was removed in migration 0109; parent sync is now
  // user-driven through a confirmation modal that calls a dedicated
  // server action. The DB must NOT flip the parent on its own.
  it("does NOT flip parent's completed_at when the last open child completes", async () => {
    const u = await makeUser("cc-all");
    const { l1 } = await setupBoardWithLists(u.jwt);

    const parent = await createCardImpl(u.jwt, { listId: l1.id, title: "Parent" });
    await updateCardImpl(u.jwt, { id: parent.id, type: "story" });

    const c1 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C1",
      parentCardId: parent.id,
    });
    const c2 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C2",
      parentCardId: parent.id,
    });
    const c3 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C3",
      parentCardId: parent.id,
    });

    await updateCardImpl(u.jwt, { id: c1.id, completed: true });
    await updateCardImpl(u.jwt, { id: c2.id, completed: true });
    await updateCardImpl(u.jwt, { id: c3.id, completed: true });

    // Even with every child complete, parent stays open — UI prompt
    // is the only path that may flip it.
    expect((await readCard(u.jwt, parent.id)).completedAt).toBeNull();
  });

  it("does NOT auto-uncomplete the parent when a child is un-checked", async () => {
    const u = await makeUser("cc-no-undo");
    const { l1 } = await setupBoardWithLists(u.jwt);

    const parent = await createCardImpl(u.jwt, { listId: l1.id, title: "Parent" });
    await updateCardImpl(u.jwt, { id: parent.id, type: "story" });
    const c1 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C1",
      parentCardId: parent.id,
    });
    const c2 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C2",
      parentCardId: parent.id,
    });
    const c3 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C3",
      parentCardId: parent.id,
    });

    await updateCardImpl(u.jwt, { id: c1.id, completed: true });
    await updateCardImpl(u.jwt, { id: c2.id, completed: true });
    await updateCardImpl(u.jwt, { id: c3.id, completed: true });

    // Simulate the modal-confirmed parent flip (the user-driven action
    // would call this; here we set it directly to mirror that intent).
    await updateCardImpl(u.jwt, { id: parent.id, completed: true });
    const completed = (await readCard(u.jwt, parent.id)).completedAt;
    expect(completed).not.toBeNull();

    // Un-check one child — parent must keep its completed_at exactly.
    // (No DB cascade re-writes the stamp; reversion is also user-driven.)
    await updateCardImpl(u.jwt, { id: c1.id, completed: false });
    const after = await readCard(u.jwt, parent.id);
    expect(after.completedAt).not.toBeNull();
    expect(after.completedAt!.toString()).toBe(completed!.toString());
  });

  it("never auto-flips parent regardless of archived children", async () => {
    const u = await makeUser("cc-arch");
    const { l1 } = await setupBoardWithLists(u.jwt);

    const parent = await createCardImpl(u.jwt, { listId: l1.id, title: "Parent" });
    await updateCardImpl(u.jwt, { id: parent.id, type: "story" });
    const c1 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C1",
      parentCardId: parent.id,
    });
    const c2 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C2",
      parentCardId: parent.id,
    });
    const c3 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "C3-archived",
      parentCardId: parent.id,
    });

    await archiveCardImpl(u.jwt, { id: c3.id, archived: true });

    // Completing every non-archived child no longer flips the parent —
    // the client owns that decision via a confirmation modal.
    await updateCardImpl(u.jwt, { id: c1.id, completed: true });
    await updateCardImpl(u.jwt, { id: c2.id, completed: true });
    expect((await readCard(u.jwt, parent.id)).completedAt).toBeNull();
    expect((await readCard(u.jwt, c3.id)).completedAt).toBeNull();
  });
});
