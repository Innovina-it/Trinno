import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
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
  return { l1 };
}

const JAN_5 = "2026-01-05T00:00:00.000Z";
const JAN_6 = "2026-01-06T00:00:00.000Z";
const JAN_8 = "2026-01-08T00:00:00.000Z";
const JAN_10 = "2026-01-10T00:00:00.000Z";
const JAN_20 = "2026-01-20T00:00:00.000Z";

describe("epic date rollup (migration 0084: INSERT-only)", () => {
  it("moving an existing child past the parent's bounds does NOT extend the parent", async () => {
    const u = await makeUser("nu");
    const { l1 } = await setupBoardWithLists(u.jwt);

    // Epic spans Jan 5 → Jan 10.
    const epic = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "Epic",
      startDate: JAN_5,
      targetDate: JAN_10,
    });
    await updateCardImpl(u.jwt, { id: epic.id, type: "epic" });

    // Child INSIDE the parent's bounds at insert time. Migration 0084
    // keeps the rollup on INSERT, so the parent is recomputed but the
    // recompute can't shrink — it's a no-op here.
    const child = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "Child",
      parentCardId: epic.id,
      startDate: JAN_6,
      targetDate: JAN_8,
    });

    // Sanity: parent is still Jan 5 → Jan 10 right after the insert.
    const [parentAfterInsert] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, epic.id)),
    );
    expect(parentAfterInsert.startDate?.toISOString()).toBe(JAN_5);
    expect(parentAfterInsert.targetDate?.toISOString()).toBe(JAN_10);

    // Now move the child past the parent's end (Jan 10 → Jan 20).
    // Pre-0084 the AIU trigger would have stretched the parent to Jan 20.
    // Post-0084 it must NOT.
    const movedChild = await updateCardImpl(u.jwt, {
      id: child.id,
      targetDate: JAN_20,
    });
    expect(movedChild.targetDate?.toISOString()).toBe(JAN_20);

    // Parent unchanged.
    const [parentAfterMove] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, epic.id)),
    );
    expect(parentAfterMove.startDate?.toISOString()).toBe(JAN_5);
    expect(parentAfterMove.targetDate?.toISOString()).toBe(JAN_10);
  });
});
