import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import {
  workspaces,
  boards,
  lists,
  cards,
  sprints,
  components,
  versions,
  dashboards,
  gadgets,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { seedDemoWorkspaceImpl } from "@/actions/seed";

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

describe("seedDemoWorkspace", () => {
  it("creates a workspace with full demo data set", async () => {
    const u = await makeUser("seed");
    const { workspaceId } = await seedDemoWorkspaceImpl(u.jwt);
    expect(workspaceId).toBeTruthy();

    // Workspace named "Demo Workspace".
    const wsRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)),
    );
    expect(wsRows).toHaveLength(1);
    expect(wsRows[0].name).toBe("Demo Workspace");

    // Default `demo` mode now funnels through the rich seed (see
    // actions/seed.ts), which creates multiple boards, sprints, and
    // ~50 cards across types. We assert invariants instead of exact
    // counts so cosmetic seed tweaks don't churn this test.
    const boardRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boards).where(eq(boards.workspaceId, workspaceId)),
    );
    expect(boardRows.length).toBeGreaterThanOrEqual(1);
    const okrBoard = boardRows.find((b) => b.title === "Product OKRs") ?? boardRows[0];

    const listRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(lists).where(eq(lists.boardId, okrBoard.id)),
    );
    expect(listRows.length).toBeGreaterThanOrEqual(5);

    const cardRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.boardId, okrBoard.id)),
    );
    expect(cardRows.length).toBeGreaterThanOrEqual(5);
    const types = new Set(cardRows.map((c) => c.type));
    expect(types.has("epic")).toBe(true);
    expect(types.has("story")).toBe(true);

    const sprintRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(sprints).where(eq(sprints.workspaceId, workspaceId)),
    );
    expect(sprintRows.length).toBeGreaterThanOrEqual(1);

    const compRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(components).where(eq(components.boardId, okrBoard.id)),
    );
    expect(compRows.length).toBeGreaterThanOrEqual(1);

    const verRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(versions).where(eq(versions.workspaceId, workspaceId)),
    );
    expect(verRows.length).toBeGreaterThanOrEqual(1);

    const dashRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(dashboards).where(eq(dashboards.ownerId, u.id)),
    );
    expect(dashRows.length).toBeGreaterThanOrEqual(1);
    const someDash = dashRows[0];
    const gadgetRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(gadgets).where(eq(gadgets.dashboardId, someDash.id)),
    );
    expect(gadgetRows.length).toBeGreaterThanOrEqual(1);
  });
});
