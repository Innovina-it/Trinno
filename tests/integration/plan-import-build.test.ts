import { describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { workspaces, boards, cards, links } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

// build.ts carries `import "server-only"`; stub it for the node test env.
vi.mock("server-only", () => ({}));

import { buildWorkspaceFromPlan } from "@/lib/plan-import/build";
import type { ProjectPlan } from "@/lib/plan-import/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function makeUser(p: string) {
  const email = `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  const { data } = await service.auth.admin.createUser({ email, password: "passw0rd!", email_confirm: true });
  const { data: s } = await createClient(url, anon).auth.signInWithPassword({ email, password: "passw0rd!" });
  return { id: data.user!.id, jwt: s.session!.access_token };
}

const plan: ProjectPlan = {
  workspaceName: "Test Plan WS",
  parentBoardTitle: "Test · Plan",
  workPackages: [
    {
      code: "WP1", title: "WP1 — Reqs", option: "RI", start: "2026-01-01", end: "2026-06-30",
      description: "d", lead: "INNOVINA",
      tasks: [
        { title: "T1.1", description: "d", owner: "INNOVINA" },
        { title: "T1.2", description: "d", owner: "INNOVINA" },
      ],
      deliverables: [{ title: "D1.1 — Reqs doc", taskIndex: 0, due: "2026-06-30", month: 6, description: "d" }],
    },
    {
      code: "WP2", title: "WP2 — Build", option: "SS", start: "2026-07-01", end: "2026-10-31",
      description: "d",
      tasks: [{ title: "T2.1", description: "d" }],
      deliverables: [{ title: "D2.1 — Build doc", taskIndex: 0, due: "2026-10-31", month: 10, description: "d" }],
    },
  ],
  milestones: [{ name: "M6 — Baseline", date: "2026-06-30", description: "d" }],
};

describe("buildWorkspaceFromPlan", () => {
  it("builds workspace, sub-boards, typed cards, deliverable links and milestones", async () => {
    const u = await makeUser("planbuild");
    const res = await buildWorkspaceFromPlan(u.jwt, plan); // no Drive folder → placeholder links
    expect(res.failures).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.workspaceId).toBeTruthy();
    const wsId = res.workspaceId!;

    await dbAsUser(u.jwt, async (tx) => {
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, wsId));
      expect(ws.name).toBe("Test Plan WS");

      const bs = await tx.select().from(boards).where(eq(boards.workspaceId, wsId));
      expect(bs.length).toBe(3); // 1 parent + 2 sub-boards
      expect(bs.filter((b) => b.parentBoardId !== null).length).toBe(2);

      const boardIds = bs.map((b) => b.id);
      const allCards = await tx.select().from(cards).where(inArray(cards.boardId, boardIds));
      // 2 anchors (task) + 3 tasks (task) + 2 deliverables (subtask) + 1 milestone card = 8.
      // Milestones are cards now (type='milestone' on the parent board's hidden list).
      expect(allCards.length).toBe(8);
      expect(allCards.filter((c) => c.type === "task").length).toBe(5);
      expect(allCards.filter((c) => c.type === "subtask").length).toBe(2);

      // The plan milestone, pinned to the parent board as a milestone-type card.
      const milestoneCards = allCards.filter((c) => c.type === "milestone");
      expect(milestoneCards.length).toBe(1);
      expect(milestoneCards[0].title).toBe("M6 — Baseline");
      expect(milestoneCards[0].boardId).toBe(bs.find((b) => b.parentBoardId === null)!.id);

      // Owner is stamped onto TASK card titles (not the WP anchor) when present.
      // WP1's tasks carry owner "INNOVINA"; WP2's task has no owner.
      const titles = allCards.map((c) => c.title);
      expect(titles).toContain("WP1 — Reqs"); // anchor title stays clean
      expect(titles).toContain("T1.1 · INNOVINA"); // task stamped with its owner
      expect(titles).toContain("T2.1"); // no owner → no suffix

      // Each deliverable got a card-scope URL link (placeholder here — no Drive folder).
      const ls = await tx.select().from(links).where(eq(links.workspaceId, wsId));
      expect(ls.filter((l) => l.scope === "card").length).toBe(2);
    });
  });
});
