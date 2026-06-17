import { describe, it, expect, vi } from "vitest";

// lib/queries/card-history.ts is tagged `import "server-only"`, which has no
// resolvable export in the vitest node runner. Stub it so the import succeeds.
vi.mock("server-only", () => ({}));
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl } from "@/actions/boards";
import { createListImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import {
  createSprintImpl,
  assignCardToSprintImpl,
} from "@/actions/sprints";
import { listCardHistory } from "@/lib/queries/card-history";

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

async function setup(jwt: string) {
  const ws = await createWorkspaceImpl(jwt, { name: "WS" });
  const b = await createBoardImpl(jwt, {
    workspaceId: ws.id,
    title: "B",
    backgroundKind: "color",
    backgroundValue: "#000",
  });
  const l = await createListImpl(jwt, { boardId: b.id, title: "L" });
  return { ws, b, l };
}

describe("card history feed", () => {
  it("merges field changes + sprint moves chronologically (newest first)", async () => {
    const u = await makeUser("hist");
    const { ws, l } = await setup(u.jwt);
    const c = await createCardImpl(u.jwt, { listId: l.id, title: "Original" });

    // Trigger several field changes.
    await updateCardImpl(u.jwt, { id: c.id, title: "Renamed" });
    await updateCardImpl(u.jwt, { id: c.id, priority: "p1" });
    await updateCardImpl(u.jwt, { id: c.id, completed: true });

    // Sprint move.
    const sp = await createSprintImpl(u.jwt, { workspaceId: ws.id, name: "S1" });
    await assignCardToSprintImpl(u.jwt, { cardId: c.id, sprintId: sp.id });

    const rows = await listCardHistory(u.jwt, c.id);
    expect(rows.length).toBeGreaterThan(0);

    const fields = rows.filter((r) => r.kind === "field").map((r) =>
      r.kind === "field" ? r.field : "",
    );
    expect(fields).toContain("title");
    expect(fields).toContain("priority");
    expect(fields).toContain("completed_at");
    expect(fields).toContain("sprint_id");

    const sprintRows = rows.filter((r) => r.kind === "sprint");
    expect(sprintRows.length).toBeGreaterThan(0);

    // Newest first.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].at.getTime()).toBeGreaterThanOrEqual(
        rows[i].at.getTime(),
      );
    }
  });
});
