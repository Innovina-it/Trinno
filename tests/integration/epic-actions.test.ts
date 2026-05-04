import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { eq, and } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import { ensureStatusListImpl } from "@/actions/lists";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl, setListStatusKindImpl } from "@/actions/lists";

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
});
