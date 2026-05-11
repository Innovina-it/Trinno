import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards, cardLabels } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createSprintImpl } from "@/actions/sprints";
import { createLabelImpl } from "@/actions/labels";
import {
  createCardImpl,
  bulkArchiveCardsImpl,
  bulkSetSprintImpl,
  bulkSetPriorityImpl,
  bulkAddLabelImpl,
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

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#000",
  });
  const l1 = await createListImpl(jwt, { boardId: b.id, title: "L1" });
  const c1 = await createCardImpl(jwt, { listId: l1.id, title: "Card 1" });
  const c2 = await createCardImpl(jwt, { listId: l1.id, title: "Card 2" });
  const c3 = await createCardImpl(jwt, { listId: l1.id, title: "Card 3" });
  return { ws, b, l1, ids: [c1.id, c2.id, c3.id] };
}

describe("bulk card actions (impl)", () => {
  it("bulkSetPriority applies one value to many ids and clears with null", async () => {
    const u = await makeUser("blk-pri");
    const { ids } = await setup(u.jwt);

    const r1 = await bulkSetPriorityImpl(u.jwt, {
      cardIds: ids,
      priority: "p0",
    });
    expect(r1.updated).toBe(3);
    const rows1 = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, ids)),
    );
    expect(rows1.every((r) => r.priority === "p0")).toBe(true);

    const r2 = await bulkSetPriorityImpl(u.jwt, {
      cardIds: ids,
      priority: null,
    });
    expect(r2.updated).toBe(3);
    const rows2 = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, ids)),
    );
    expect(rows2.every((r) => r.priority === null)).toBe(true);
  });

  it("bulkSetPriority rejects unknown enum and oversized batches", async () => {
    const u = await makeUser("blk-pri-bad");
    const { ids } = await setup(u.jwt);
    await expect(
      bulkSetPriorityImpl(u.jwt, {
        cardIds: ids,
        // @ts-expect-error invalid priority
        priority: "p9",
      }),
    ).rejects.toThrow();
    await expect(
      bulkSetPriorityImpl(u.jwt, {
        cardIds: Array.from({ length: 51 }, () => ids[0]),
        priority: "p1",
      }),
    ).rejects.toThrow();
  });

  it("bulkSetPriority on a non-member's card updates 0 rows (RLS)", async () => {
    const owner = await makeUser("blk-pri-own");
    const other = await makeUser("blk-pri-x");
    const { ids } = await setup(owner.jwt);
    const r = await bulkSetPriorityImpl(other.jwt, {
      cardIds: ids,
      priority: "p0",
    });
    expect(r.updated).toBe(0);
  });

  it("bulkArchiveCards archives and unarchives a batch", async () => {
    const u = await makeUser("blk-arc");
    const { ids } = await setup(u.jwt);
    await bulkArchiveCardsImpl(u.jwt, { cardIds: ids, archived: true });
    const rowsA = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, ids)),
    );
    expect(rowsA.every((r) => r.archived === true)).toBe(true);
    await bulkArchiveCardsImpl(u.jwt, { cardIds: ids, archived: false });
    const rowsB = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, ids)),
    );
    expect(rowsB.every((r) => r.archived === false)).toBe(true);
  });

  it("bulkSetSprint assigns then clears (null = backlog)", async () => {
    const u = await makeUser("blk-spr");
    const { ws, ids } = await setup(u.jwt);
    const sprint = await createSprintImpl(u.jwt, {
      workspaceId: ws.id,
      name: "S1",
    });
    await bulkSetSprintImpl(u.jwt, { cardIds: ids, sprintId: sprint.id });
    const rowsA = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, ids)),
    );
    expect(rowsA.every((r) => r.sprintId === sprint.id)).toBe(true);
    await bulkSetSprintImpl(u.jwt, { cardIds: ids, sprintId: null });
    const rowsB = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(inArray(cards.id, ids)),
    );
    expect(rowsB.every((r) => r.sprintId === null)).toBe(true);
  });

  it("bulkAddLabel inserts once per card and is idempotent", async () => {
    const u = await makeUser("blk-lbl");
    const { b, ids } = await setup(u.jwt);
    const label = await createLabelImpl(u.jwt, {
      boardId: b.id,
      name: "Bug",
      color: "#ff0000",
    });
    const r1 = await bulkAddLabelImpl(u.jwt, {
      cardIds: ids,
      labelId: label.id,
    });
    expect(r1.inserted).toBe(3);
    // Second call should be a no-op.
    const r2 = await bulkAddLabelImpl(u.jwt, {
      cardIds: ids,
      labelId: label.id,
    });
    expect(r2.inserted).toBe(0);
    const rows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cardLabels).where(eq(cardLabels.labelId, label.id)),
    );
    expect(rows.length).toBe(3);
  });
});
