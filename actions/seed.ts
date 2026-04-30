"use server";
import { revalidatePath } from "next/cache";
import { getSessionToken, requireUser } from "@/lib/auth";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardFromTemplateImpl } from "@/actions/boards";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import { createLabelImpl, toggleCardLabelImpl } from "@/actions/labels";
import { createSprintImpl, assignCardToSprintImpl } from "@/actions/sprints";
import { createComponentImpl } from "@/actions/components";
import { createVersionImpl } from "@/actions/versions";
import { createDashboardImpl } from "@/actions/dashboards";
import { createGadgetImpl } from "@/actions/gadgets";

const DAY_MS = 86_400_000;

/**
 * Plan #16b-γ-B (#5) — Seed an illustrative demo workspace for a fresh
 * user. Calls existing impls sequentially so each owns its own dbAsUser
 * scope. Each step is RLS-checked individually; partial failure leaves
 * partial seed (acceptable for v1 — caller surfaces the error and the user
 * can delete the half-baked workspace via settings).
 *
 * Returns the workspace id so the auth callback can redirect the user
 * straight into their freshly populated tenant.
 */
export async function seedDemoWorkspaceImpl(
  token: string,
): Promise<{ workspaceId: string }> {
  const ws = await createWorkspaceImpl(token, { name: "Demo Workspace" });

  // Board pre-seeded with the OKR/Sprint template (5 lists + status mapping
  // + 2 labels). The "blank" template would leave us with nothing to attach
  // cards to, so we always start from okr_sprint.
  const { board, listIds } = await createBoardFromTemplateImpl(token, {
    workspaceId: ws.id,
    title: "Demo board",
    backgroundKind: "color",
    backgroundValue: "#fafafa",
    templateId: "okr_sprint",
  });

  // Indices match createBoardFromTemplateImpl's preserved declaration order:
  // 0=Backlog, 1=This sprint, 2=In progress, 3=Review, 4=Done.
  const backlogId = listIds[0];
  const sprintListId = listIds[1];
  const inProgId = listIds[2];

  // Add a P0 label so the bug card has a priority signal.
  const p0Label = await createLabelImpl(token, {
    boardId: board.id,
    name: "P0",
    color: "#fafafa",
  });

  // Cards
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  const plus = (n: number) => new Date(today.getTime() + n * DAY_MS);

  const epic = await createCardImpl(token, {
    listId: backlogId,
    title: "Build auth flow",
  });
  await updateCardImpl(token, {
    id: epic.id,
    type: "epic",
    storyPoints: 13,
    startDate: today,
    targetDate: plus(21),
    dueDate: plus(14),
  });

  const story = await createCardImpl(token, {
    listId: sprintListId,
    title: "Wire login form",
  });
  await updateCardImpl(token, {
    id: story.id,
    type: "story",
    parentCardId: epic.id,
    storyPoints: 5,
    dueDate: plus(7),
  });

  const subtask = await createCardImpl(token, {
    listId: sprintListId,
    title: "Add forgot-password",
  });
  await updateCardImpl(token, {
    id: subtask.id,
    type: "subtask",
    parentCardId: story.id,
    storyPoints: 2,
  });

  const bug = await createCardImpl(token, {
    listId: inProgId,
    title: "Bug: token expiry off by 1",
  });
  await updateCardImpl(token, {
    id: bug.id,
    type: "bug",
  });
  await toggleCardLabelImpl(token, {
    cardId: bug.id,
    labelId: p0Label.id,
  });

  const task = await createCardImpl(token, {
    listId: backlogId,
    title: "Polish landing page",
  });
  await updateCardImpl(token, {
    id: task.id,
    type: "task",
    storyPoints: 3,
  });

  // Sprint — planned, tomorrow → +14 days. Cards 2-5 (story, subtask, bug,
  // task) get assigned. Epic stays at backlog so the roadmap shows it as a
  // larger umbrella bar.
  const sprint = await createSprintImpl(token, {
    workspaceId: ws.id,
    name: "Demo Sprint 1",
    startDate: plus(1),
    endDate: plus(14),
  });
  for (const c of [story, subtask, bug, task]) {
    await assignCardToSprintImpl(token, {
      cardId: c.id,
      sprintId: sprint.id,
    });
  }

  // Component (board-scoped) and version (workspace-scoped).
  await createComponentImpl(token, {
    boardId: board.id,
    name: "Frontend",
  });
  await createVersionImpl(token, {
    workspaceId: ws.id,
    name: "v1.0",
  });

  // Personal dashboard with 3 starter gadgets.
  const dash = await createDashboardImpl(token, {
    name: "Demo dashboard",
    scope: "personal",
  });
  await createGadgetImpl(token, {
    dashboardId: dash.id,
    type: "count",
    config: { metric: "open_cards" },
    size: "1x1",
  });
  await createGadgetImpl(token, {
    dashboardId: dash.id,
    type: "velocity",
    config: { workspaceId: ws.id, n: 6 },
    size: "2x1",
  });
  await createGadgetImpl(token, {
    dashboardId: dash.id,
    type: "markdown_note",
    config: {
      body:
        "## Welcome!\nThis is a seeded workspace. Explore the board, roadmap, and dashboards — delete this workspace anytime from Settings.",
    },
    size: "2x1",
  });

  return { workspaceId: ws.id };
}

export async function seedDemoWorkspace() {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await seedDemoWorkspaceImpl(t);
  revalidatePath("/");
  return r;
}
