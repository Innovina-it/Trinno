import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { dbAsUser } from "@/lib/db/client";
import { lists, labels } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardFromTemplateImpl } from "@/actions/boards";
import { BOARD_TEMPLATES } from "@/lib/board-templates";

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

describe("board templates", () => {
  it("blank template seeds zero lists + zero labels", async () => {
    const u = await makeUser("tpl-blank");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const { board, listIds } = await createBoardFromTemplateImpl(u.jwt, {
      workspaceId: ws.id,
      title: "Blank",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
      templateId: "blank",
    });
    expect(listIds).toHaveLength(0);
    const ls = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(lists).where(eq(lists.boardId, board.id)),
    );
    expect(ls).toHaveLength(0);
    const lbs = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(labels).where(eq(labels.boardId, board.id)),
    );
    expect(lbs).toHaveLength(0);
  });

  it("standup template — 3 lists with statusKind, 2 labels", async () => {
    const u = await makeUser("tpl-su");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const { board, listIds } = await createBoardFromTemplateImpl(u.jwt, {
      workspaceId: ws.id,
      title: "Standup",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
      templateId: "standup",
    });
    expect(listIds).toHaveLength(3);
    const ls = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(eq(lists.boardId, board.id))
        .orderBy(asc(lists.position)),
    );
    expect(ls.map((l) => l.title)).toEqual(["Yesterday", "Today", "Blockers"]);
    expect(ls.map((l) => l.statusKind)).toEqual([
      "done",
      "in_progress",
      "blocked",
    ]);
    const lbs = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(labels).where(eq(labels.boardId, board.id)),
    );
    expect(lbs.map((l) => l.name).sort()).toEqual(["blocker", "fyi"]);
  });

  it("bug_triage template — 5 lists in order with mapped statuses, 4 labels", async () => {
    const u = await makeUser("tpl-bt");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const { board, listIds } = await createBoardFromTemplateImpl(u.jwt, {
      workspaceId: ws.id,
      title: "Triage",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
      templateId: "bug_triage",
    });
    expect(listIds).toHaveLength(5);
    const ls = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(eq(lists.boardId, board.id))
        .orderBy(asc(lists.position)),
    );
    expect(ls.map((l) => l.title)).toEqual([
      "Inbox",
      "Triaging",
      "In progress",
      "Verifying",
      "Closed",
    ]);
    expect(ls.map((l) => l.statusKind)).toEqual([
      null,
      "todo",
      "in_progress",
      "review",
      "done",
    ]);
    const lbs = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(labels).where(eq(labels.boardId, board.id)),
    );
    expect(lbs.map((l) => l.name).sort()).toEqual([
      "crash",
      "data-loss",
      "perf",
      "regression",
      "ui",
    ]);
  });

  it("okr_sprint template — 5 lists with full status pipeline, 2 labels", async () => {
    const u = await makeUser("tpl-okr");
    const ws = await createWorkspaceImpl(u.jwt, { name: "WS" });
    const tpl = BOARD_TEMPLATES.find((t) => t.id === "okr_sprint")!;
    const { board, listIds } = await createBoardFromTemplateImpl(u.jwt, {
      workspaceId: ws.id,
      title: "OKR",
      backgroundKind: "color",
      backgroundValue: "#fafafa",
      templateId: "okr_sprint",
    });
    expect(listIds).toHaveLength(tpl.lists.length);
    const ls = await dbAsUser(u.jwt, async (tx) =>
      tx
        .select()
        .from(lists)
        .where(eq(lists.boardId, board.id))
        .orderBy(asc(lists.position)),
    );
    expect(ls.map((l) => l.title)).toEqual(tpl.lists.map((x) => x.title));
    expect(ls.map((l) => l.statusKind)).toEqual(
      tpl.lists.map((x) => x.statusKind ?? null),
    );
    const lbs = await dbAsUser(u.jwt, async (tx) =>
      tx.select().from(labels).where(eq(labels.boardId, board.id)),
    );
    expect(lbs.map((l) => l.name).sort()).toEqual(["key-result", "objective"]);
  });
});
