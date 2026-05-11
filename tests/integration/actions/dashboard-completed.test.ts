import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import { resolveDueThisWeek } from "@/lib/dashboards/resolvers";

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
  return { ws, b, l1 };
}

describe("resolveDueThisWeek excludes completed cards (completedAt filter)", () => {
  it("returns only non-completed cards whose due date is in the next 7 days", async () => {
    const u = await makeUser("dash");
    const { ws, l1 } = await setupBoardWithLists(u.jwt);

    const dayMs = 86_400_000;
    const inTwoDays = new Date(Date.now() + 2 * dayMs);
    const inThreeDays = new Date(Date.now() + 3 * dayMs);
    const inTenDays = new Date(Date.now() + 10 * dayMs);

    // 1) Due in 2 days, not completed → should appear.
    const c1 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "open-this-week",
    });
    await updateCardImpl(u.jwt, { id: c1.id, dueDate: inTwoDays });

    // 2) Due in 3 days, completed → must be filtered out by isNull(completedAt).
    const c2 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "done-this-week",
    });
    await updateCardImpl(u.jwt, { id: c2.id, dueDate: inThreeDays });
    await updateCardImpl(u.jwt, { id: c2.id, completed: true });

    // 3) Due in 10 days, not completed → outside the 7-day window.
    const c3 = await createCardImpl(u.jwt, {
      listId: l1.id,
      title: "later",
    });
    await updateCardImpl(u.jwt, { id: c3.id, dueDate: inTenDays });

    // 4) No due date, not completed → not surfaced (isNotNull(dueDate)).
    await createCardImpl(u.jwt, { listId: l1.id, title: "no-due" });

    const rows = await resolveDueThisWeek(u.jwt, u.id, { workspaceId: ws.id });
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(c1.id);
    expect(ids).not.toContain(c2.id); // completed → excluded
    expect(ids).not.toContain(c3.id); // outside 7-day window
    // Strict count: workspace-scoped query, only one row qualifies.
    expect(rows.length).toBe(1);
  });
});
