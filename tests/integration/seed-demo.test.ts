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

    // One board, with the okr_sprint template (5 lists).
    const boardRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(boards).where(eq(boards.workspaceId, workspaceId)),
    );
    expect(boardRows).toHaveLength(1);
    const board = boardRows[0];
    expect(board.title).toBe("Demo board");

    const listRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(lists).where(eq(lists.boardId, board.id)),
    );
    expect(listRows).toHaveLength(5);

    // 5 demo cards with mixed types.
    const cardRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(cards).where(eq(cards.boardId, board.id)),
    );
    expect(cardRows).toHaveLength(5);
    const types = cardRows.map((c) => c.type).sort();
    expect(types).toEqual(["bug", "epic", "story", "subtask", "task"]);

    // One sprint.
    const sprintRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(sprints).where(eq(sprints.workspaceId, workspaceId)),
    );
    expect(sprintRows).toHaveLength(1);
    expect(sprintRows[0].name).toBe("Sprint 1");

    // 4 cards assigned to the sprint (story, subtask, bug, task — epic stays out).
    const assigned = cardRows.filter(
      (c) => c.sprintId === sprintRows[0].id,
    );
    expect(assigned).toHaveLength(4);

    // One component on the board.
    const compRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(components).where(eq(components.boardId, board.id)),
    );
    expect(compRows).toHaveLength(1);
    expect(compRows[0].name).toBe("Frontend");

    // One version in the workspace.
    const verRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(versions).where(eq(versions.workspaceId, workspaceId)),
    );
    expect(verRows).toHaveLength(1);
    expect(verRows[0].name).toBe("v1.0");

    // One personal dashboard with 3 gadgets.
    const dashRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(dashboards).where(eq(dashboards.ownerId, u.id)),
    );
    expect(dashRows.length).toBeGreaterThanOrEqual(1);
    const demoDash = dashRows.find((d) => d.name === "Demo dashboard");
    expect(demoDash).toBeTruthy();

    const gadgetRows = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(gadgets).where(eq(gadgets.dashboardId, demoDash!.id)),
    );
    expect(gadgetRows).toHaveLength(3);
    const gTypes = gadgetRows.map((g) => g.type).sort();
    expect(gTypes).toEqual(["count", "markdown_note", "velocity"]);
  });
});
