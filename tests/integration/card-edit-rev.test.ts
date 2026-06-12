import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { StructuredError } from "@/lib/errors/structured-error";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";

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

describe("card-edit-concurrency: edit_rev check in updateCardImpl", () => {
  it("trigger bumps rev on text change only; responses carry edit_rev", async () => {
    const u = await makeUser("rev1");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "T0" });
    expect((c as { editRev?: number }).editRev ?? 0).toBe(0);

    const r1 = await updateCardImpl(u.jwt, { id: c.id, title: "T1" });
    expect(r1.editRev).toBe(1);
    // Non-text update: rev untouched.
    const r2 = await updateCardImpl(u.jwt, { id: c.id, priority: "p1" });
    expect(r2.editRev).toBe(1);
  });

  it("stale rev on a text patch → VERSION_CONFLICT carrying current text", async () => {
    const u = await makeUser("rev2");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "Original" });

    // Session A saves with rev 0 → rev becomes 1.
    await updateCardImpl(u.jwt, { id: c.id, title: "From A", expectedEditRev: 0 });

    // Session B still believes rev 0 → must conflict, not "Forbidden".
    let caught: unknown;
    try {
      await updateCardImpl(u.jwt, {
        id: c.id,
        title: "From B",
        expectedEditRev: 0,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StructuredError);
    const se = caught as StructuredError;
    expect(se.code).toBe("VERSION_CONFLICT");
    const ctx = se.context as {
      currentRev: number;
      currentTitle: string;
      currentDescription: string | null;
    };
    expect(ctx.currentRev).toBe(1);
    expect(ctx.currentTitle).toBe("From A");

    // The losing write must NOT have landed.
    const [row] = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.id, c.id)),
    );
    expect(row.title).toBe("From A");
    expect(row.editRev).toBe(1);
  });

  it("fresh rev goes through; rev omitted = today's last-write-wins; rev on non-text patch ignored", async () => {
    const u = await makeUser("rev3");
    const { l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "X" });

    const r1 = await updateCardImpl(u.jwt, { id: c.id, title: "Y", expectedEditRev: 0 });
    expect(r1.editRev).toBe(1);
    // Conflict-then-retry with the fresh rev (keep-mine path).
    const r2 = await updateCardImpl(u.jwt, { id: c.id, title: "Z", expectedEditRev: 1 });
    expect(r2.editRev).toBe(2);
    // No rev supplied → unchecked write still allowed (undo/seed/bulk paths).
    const r3 = await updateCardImpl(u.jwt, { id: c.id, title: "W" });
    expect(r3.editRev).toBe(3);
    // Stale rev + NON-text patch → check not engaged, write succeeds.
    const r4 = await updateCardImpl(u.jwt, {
      id: c.id,
      priority: "p2",
      expectedEditRev: 0,
    });
    expect(r4.editRev).toBe(3);
  });
});
