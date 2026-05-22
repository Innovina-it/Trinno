"use server";
import { revalidatePath } from "next/cache";
import { getSessionToken, requireUser } from "@/lib/auth";
import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardFromTemplateImpl } from "@/actions/boards";
import { createCardImpl, updateCardImpl, archiveCardImpl } from "@/actions/cards";
import { createLabelImpl, toggleCardLabelImpl } from "@/actions/labels";
import {
  createSprintImpl,
  assignCardToSprintImpl,
  startSprintImpl,
  completeSprintImpl,
} from "@/actions/sprints";
import { createComponentImpl } from "@/actions/components";
import { createVersionImpl } from "@/actions/versions";
import { createDashboardImpl } from "@/actions/dashboards";
import { createGadgetImpl } from "@/actions/gadgets";
import { markOnboardingCompletedImpl } from "@/actions/onboarding";
import { toggleCardMemberImpl } from "@/actions/card-members";
import { createCommentImpl } from "@/actions/comments";
import {
  createChecklistImpl,
  addChecklistItemImpl,
  toggleChecklistItemImpl,
} from "@/actions/checklists";
import { createCardLinkImpl } from "@/actions/card-links";
import { watchCardImpl } from "@/actions/watchers";
import { StructuredError, toStructuredError } from "@/lib/errors";

const DAY_MS = 86_400_000;

export type SeedFailure = { step: string; error: unknown };
export type SeedResult = {
  ok: boolean;
  partial: boolean;
  workspaceId: string | null;
  failures: SeedFailure[];
};

type SeedOpts = {
  mode?: "demo" | "minimal" | "rich";
  __testFailStep?: string;
};

async function seedStep<T>(
  failures: SeedFailure[],
  step: string,
  fn: () => Promise<T>,
  failStep?: string,
): Promise<T | null> {
  try {
    if (failStep === step) {
      throw new StructuredError("SEED_TEST_FAILURE", `Forced failure: ${step}`, {
        step,
      });
    }
    return await fn();
  } catch (error) {
    failures.push({
      step,
      error: toStructuredError(error, "SEED_STEP_FAILED", { step }),
    });
    return null;
  }
}

function seedResult(
  workspaceId: string | null,
  failures: SeedFailure[],
): SeedResult {
  return {
    ok: failures.length === 0,
    partial: workspaceId !== null && failures.length > 0,
    workspaceId,
    failures,
  };
}

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
  opts: SeedOpts = {},
): Promise<SeedResult> {
  const mode = opts.mode ?? "demo";
  const failures: SeedFailure[] = [];
  // 'demo' (the signup-form checkbox) and 'rich' both produce the
  // populated workspace.  'minimal' is the e2e shortcut that creates
  // only the workspace shell.
  if (mode === "demo" || mode === "rich") {
    return seedRichDemoImpl(token, failures, opts.__testFailStep);
  }
  const ws = await seedStep(
    failures,
    "workspace",
    () =>
      createWorkspaceImpl(token, {
        name: mode === "minimal" ? "Test Workspace" : "Demo Workspace",
      }),
    opts.__testFailStep,
  );
  if (!ws) return seedResult(null, failures);

  // Minimal mode: just the workspace.  Used by e2e tests so each spec
  // builds the exact fixture it needs without colliding with seeded
  // boards/cards/sprints.
  if (mode === "minimal") {
    await seedStep(
      failures,
      "mark-onboarding-completed",
      () => markOnboardingCompletedImpl(token),
      opts.__testFailStep,
    );
    return seedResult(ws.id, failures);
  }

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

  // Severity is set via the `priority` enum below, not a label.

  // Cards
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  const plus = (n: number) => new Date(today.getTime() + n * DAY_MS);

  const parentStory = await createCardImpl(token, {
    listId: backlogId,
    title: "Build auth flow",
  });
  await updateCardImpl(token, {
    id: parentStory.id,
    type: "story",
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
    parentCardId: parentStory.id,
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
    priority: "p0",
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
  // task) get assigned. Parent story stays at backlog so the roadmap shows it as a
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

  // The seeded workspace is fully populated, so the first-run tour has
  // nothing to teach.  Mark onboarding complete so the overlay never
  // shows for users who came in via the demo seed (this also unblocks
  // e2e tests, which always seed).
  try {
    await markOnboardingCompletedImpl(token);
  } catch {
    // Non-fatal — the tour will still hide on Skip / Finish.
  }

  return seedResult(ws.id, failures);
}

export async function seedDemoWorkspace() {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await seedDemoWorkspaceImpl(t);
  revalidatePath("/");
  return r;
}

// -------------------------------------------------------------------
// "Rich" seed — pile of dummy data to exercise every feature surface.
// 3 boards, 4 sprints, ~50 cards spanning story/task/subtask/bug
// across past + future + far-future, with priorities, labels, owners,
// collaborators, components, versions, archived rows. Owner is always
// the seeding user (we can't service-role-create extra members from
// inside a user-context action).
// -------------------------------------------------------------------

const PRIORITIES = ["p0", "p1", "p2", "p3", "p4"] as const;
function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

function decodeSubLocal(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

async function seedRichDemoImpl(
  token: string,
  failures: SeedFailure[] = [],
  failStep?: string,
): Promise<SeedResult> {
  const userId = decodeSubLocal(token);
  // Both 'demo' and 'rich' modes funnel here; keep the name "Demo
  // Workspace" so the seed is indistinguishable to the user (and to
  // the existing seed-demo integration test).
  const ws = await seedStep(
    failures,
    "workspace",
    () => createWorkspaceImpl(token, { name: "Demo Workspace" }),
    failStep,
  );
  if (!ws) return seedResult(null, failures);

  // ---- Boards (3 different templates) ----
  const okr = await seedStep(
    failures,
    "board-product-okrs",
    () =>
      createBoardFromTemplateImpl(token, {
        workspaceId: ws.id,
        title: "Product OKRs",
        backgroundKind: "color",
        backgroundValue: "#0f0f12",
        templateId: "okr_sprint",
      }),
    failStep,
  );
  const triage = await seedStep(
    failures,
    "board-bug-triage",
    () =>
      createBoardFromTemplateImpl(token, {
        workspaceId: ws.id,
        title: "Bug triage",
        backgroundKind: "color",
        backgroundValue: "#16151b",
        templateId: "bug_triage",
      }),
    failStep,
  );
  const standup = await seedStep(
    failures,
    "board-daily-standup",
    () =>
      createBoardFromTemplateImpl(token, {
        workspaceId: ws.id,
        title: "Daily standup",
        backgroundKind: "color",
        backgroundValue: "#101418",
        templateId: "standup",
      }),
    failStep,
  );
  if (!okr || !triage || !standup) return seedResult(ws.id, failures);

  // OKR list ids: 0 Backlog, 1 This sprint, 2 In progress, 3 Review, 4 Done
  const okrBacklog = okr.listIds[0];
  const okrSprint = okr.listIds[1];
  const okrInProg = okr.listIds[2];
  const okrReview = okr.listIds[3];
  const okrDone = okr.listIds[4];
  // Triage: 0 Inbox, 1 Triaging, 2 In progress, 3 Verifying, 4 Closed
  const triageTriaging = triage.listIds[1];
  const triageInProg = triage.listIds[2];
  const triageClosed = triage.listIds[4];
  // Standup: 0 Yesterday, 1 Today, 2 Blockers
  const standupToday = standup.listIds[1];
  const standupBlocked = standup.listIds[2];

  // ---- Labels (extra on okr board) ----
  // Severity (P0–P4) is owned by the `priority` enum on each card row, not
  // labels. Categorical tags only.
  const labelTech = await createLabelImpl(token, {
    boardId: okr.board.id,
    name: "tech-debt",
    color: "#fafafa",
  });
  const labelGrowth = await createLabelImpl(token, {
    boardId: okr.board.id,
    name: "growth",
    color: "#fafafa",
  });

  // ---- Components on okr board ----
  await createComponentImpl(token, { boardId: okr.board.id, name: "Frontend" });
  await createComponentImpl(token, { boardId: okr.board.id, name: "Backend" });
  await createComponentImpl(token, { boardId: okr.board.id, name: "Infra" });

  // ---- Versions ----
  await createVersionImpl(token, { workspaceId: ws.id, name: "v1.0" });
  await createVersionImpl(token, { workspaceId: ws.id, name: "v1.1" });
  await createVersionImpl(token, { workspaceId: ws.id, name: "v2.0" });

  // ---- Sprints (past, current, next, future) ----
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  const day = (n: number) => new Date(today.getTime() + n * DAY_MS);

  const sprintPast = await createSprintImpl(token, {
    workspaceId: ws.id,
    name: "Sprint 14 (closed)",
    startDate: day(-28),
    endDate: day(-15),
  });
  const sprintNow = await createSprintImpl(token, {
    workspaceId: ws.id,
    name: "Sprint 15 (active)",
    startDate: day(-14),
    endDate: day(0),
  });
  const sprintNext = await createSprintImpl(token, {
    workspaceId: ws.id,
    name: "Sprint 16 (planned)",
    startDate: day(1),
    endDate: day(14),
  });
  const sprintFar = await createSprintImpl(token, {
    workspaceId: ws.id,
    name: "Sprint 17 (planned)",
    startDate: day(15),
    endDate: day(28),
  });

  // Move sprintNow into the active state so the /me dashboard's
  // "Active sprints" panel renders something. (createSprintImpl
  // defaults to state='planned'; only startSprintImpl flips it.)
  // sprintPast gets fully closed so velocity shows it.
  try {
    await startSprintImpl(token, { id: sprintNow.id });
  } catch {
    /* non-fatal — workspace may have invariants we're not aware of */
  }

  // ---- Initiative 1: "Onboarding revamp" w/ 4 stories + subtasks ----
  const initiative1 = await createCardImpl(token, {
    listId: okrBacklog,
    title: "Onboarding revamp",
    startDate: day(-7),
    targetDate: day(35),
  });
  await updateCardImpl(token, {
    id: initiative1.id,
    type: "story",
    storyPoints: 21,
    priority: "p1",
    ownerId: userId,
    description:
      "## Goal\nLift activation rate from 38% to 55% by Q3.\n\n## Scope\n- New welcome wizard\n- Empty-state illustrations\n- Sample-data toggle on signup\n- Polished tour overlay\n\n## Out of scope\nMarketing email sequence (owned by growth).",
  });
  await toggleCardLabelImpl(token, { cardId: initiative1.id, labelId: labelGrowth.id });

  const stories1: Array<{ id: string; boardId: string }> = [];
  for (let i = 0; i < 4; i++) {
    const titles = [
      "Welcome wizard",
      "Empty-state illustrations",
      "Sample-data toggle",
      "Tour overlay polish",
    ];
    const list = i < 2 ? okrSprint : okrInProg;
    const s = await createCardImpl(token, {
      listId: list,
      title: titles[i],
      parentCardId: initiative1.id,
      startDate: day(i * 4 - 5),
      targetDate: day(i * 4 + 4),
    });
    await updateCardImpl(token, {
      id: s.id,
      type: "story",
      parentCardId: initiative1.id,
      storyPoints: pick([3, 5, 8, 13], i),
      priority: pick(PRIORITIES, i + 1),
      estimateMin: pick([240, 480, 720, 960], i),
      ownerId: userId,
    });
    stories1.push(s);
    await assignCardToSprintImpl(token, {
      cardId: s.id,
      sprintId: i < 2 ? sprintNow.id : sprintNext.id,
    });
  }
  // 3 subtasks under first story
  for (let i = 0; i < 3; i++) {
    const sub = await createCardImpl(token, {
      listId: okrSprint,
      title: `Wire step ${i + 1}`,
      parentCardId: stories1[0].id,
      startDate: day(i * 2 - 4),
      targetDate: day(i * 2 - 1),
    });
    await updateCardImpl(token, {
      id: sub.id,
      type: "subtask",
      parentCardId: stories1[0].id,
      storyPoints: 1,
      estimateMin: 120,
      ownerId: userId,
    });
  }

  // ---- Initiative 2: "Performance pass" w/ 3 stories ----
  const initiative2 = await createCardImpl(token, {
    listId: okrBacklog,
    title: "Performance pass Q3",
    startDate: day(7),
    targetDate: day(56),
  });
  await updateCardImpl(token, {
    id: initiative2.id,
    type: "story",
    storyPoints: 13,
    priority: "p2",
    ownerId: userId,
    description:
      "## Goal\nGet p95 navigation under 200ms across the board page.\n\n## Workstreams\n1. Code-split routes\n2. Cache board snapshots\n3. Index hot tables (cards, activity, notifications)\n\n## Risks\nIndex changes need staging soak; coordinate with infra.",
  });
  await toggleCardLabelImpl(token, { cardId: initiative2.id, labelId: labelTech.id });

  for (let i = 0; i < 3; i++) {
    const titles = ["Code-split routes", "Cache snapshots", "Index hot tables"];
    const s = await createCardImpl(token, {
      listId: okrBacklog,
      title: titles[i],
      parentCardId: initiative2.id,
      startDate: day(7 + i * 8),
      targetDate: day(7 + i * 8 + 10),
    });
    await updateCardImpl(token, {
      id: s.id,
      type: "story",
      parentCardId: initiative2.id,
      storyPoints: pick([5, 8, 13], i),
      priority: pick(PRIORITIES, i),
      estimateMin: pick([480, 720, 1200], i),
      ownerId: userId,
    });
    await assignCardToSprintImpl(token, {
      cardId: s.id,
      sprintId: i < 2 ? sprintNext.id : sprintFar.id,
    });
  }

  // ---- Initiative 3: "Mobile beta" — far-future, no children yet ----
  const initiative3 = await createCardImpl(token, {
    listId: okrBacklog,
    title: "Mobile beta launch",
    startDate: day(45),
    targetDate: day(110),
  });
  await updateCardImpl(token, {
    id: initiative3.id,
    type: "story",
    storyPoints: 34,
    priority: "p3",
    ownerId: userId,
  });

  // ---- Standalone tasks (mix of dated + undated) ----
  const standaloneTitles = [
    "Polish landing page",
    "Update OG images",
    "Refresh privacy policy",
    "Audit accessibility",
    "Translate strings (es)",
    "Translate strings (fr)",
  ];
  for (let i = 0; i < standaloneTitles.length; i++) {
    const dated = i % 2 === 0;
    const t = await createCardImpl(token, {
      listId: i < 3 ? okrBacklog : okrReview,
      title: standaloneTitles[i],
      ...(dated && { startDate: day(i * 3), targetDate: day(i * 3 + 5) }),
    });
    await updateCardImpl(token, {
      id: t.id,
      type: "task",
      storyPoints: pick([1, 2, 3, 5], i),
      priority: pick(PRIORITIES, i),
      ownerId: i % 3 === 0 ? userId : null,
    });
  }

  // ---- Bugs on triage board, varied priorities ----
  const bugTitles = [
    "Token expiry off-by-1",
    "Modal traps focus on Esc",
    "Realtime drops on reconnect",
    "Date picker shows yesterday on DST",
    "Drag ghost lingers after drop",
    "PDF export truncates wide tables",
    "Notification bell stale count",
  ];
  for (let i = 0; i < bugTitles.length; i++) {
    const list =
      i < 2 ? triageTriaging : i < 5 ? triageInProg : triageClosed;
    const b = await createCardImpl(token, {
      listId: list,
      title: bugTitles[i],
      startDate: day(i - 10),
      targetDate: day(i - 3),
    });
    await updateCardImpl(token, {
      id: b.id,
      type: "bug",
      priority: pick(PRIORITIES, i),
      ownerId: userId,
      estimateMin: pick([60, 120, 180, 240], i),
    });
  }

  // ---- Standup notes (today / blocked) ----
  for (const t of ["Sync with design", "Demo prep", "Kickoff Q3 planning"]) {
    const c = await createCardImpl(token, { listId: standupToday, title: t });
    await updateCardImpl(token, { id: c.id, type: "task", ownerId: userId });
  }
  const blocker = await createCardImpl(token, {
    listId: standupBlocked,
    title: "Waiting on legal review",
  });
  await updateCardImpl(token, {
    id: blocker.id,
    type: "task",
    priority: "p1",
    ownerId: userId,
  });

  // ---- Done items (completed work, populates velocity gadget) ----
  for (let i = 0; i < 4; i++) {
    const d = await createCardImpl(token, {
      listId: okrDone,
      title: `Done: ${pick(["Refactor auth", "Add SSO", "Schema audit", "Deflake CI"], i)}`,
      startDate: day(-30 + i * 5),
      targetDate: day(-25 + i * 5),
    });
    await updateCardImpl(token, {
      id: d.id,
      type: "story",
      storyPoints: pick([3, 5, 8], i),
      ownerId: userId,
    });
    await assignCardToSprintImpl(token, {
      cardId: d.id,
      sprintId: sprintPast.id,
    });
  }

  // Close sprintPast so velocity gadget + completed-sprint pages have
  // data. completeSprintImpl rejects unless the sprint is active, so
  // start → complete in sequence.
  try {
    await startSprintImpl(token, { id: sprintPast.id });
    await completeSprintImpl(token, {
      id: sprintPast.id,
      carryoverTo: "backlog",
    });
  } catch {
    /* non-fatal */
  }

  // ---- Archive a couple to populate the archive view ----
  const arch1 = await createCardImpl(token, {
    listId: okrBacklog,
    title: "Old: prototype dark mode",
  });
  await updateCardImpl(token, { id: arch1.id, type: "task" });
  await archiveCardImpl(token, { id: arch1.id, archived: true });

  // ---- Multi-assign self as collaborator on a few cards (so workload
  //      shows both owner + member rows for them — exercises dedup). ----
  for (const s of stories1.slice(0, 2)) {
    try {
      await toggleCardMemberImpl(token, { cardId: s.id, userId });
    } catch {
      /* idempotent best-effort */
    }
  }

  // ---- Comments on key cards (markdown + activity surface) ----
  // Each comment also auto-watches the author.
  await seedStep(failures, "comment.initiative1.kickoff", () =>
    createCommentImpl(token, {
      cardId: initiative1.id,
      body:
        "Kickoff sync is on the calendar.\n\n- Wireframes by Tue\n- Copy review by Thu\n- First pass live by next Sprint demo",
    }),
    failStep,
  );
  await seedStep(failures, "comment.initiative1.update", () =>
    createCommentImpl(token, {
      cardId: initiative1.id,
      body:
        "Update: design has the welcome wizard wireframes ready.  See [Figma board](https://figma.com).",
    }),
    failStep,
  );
  await seedStep(failures, "comment.story1.split", () =>
    createCommentImpl(token, {
      cardId: stories1[0].id,
      body: "Splitting the wizard into 3 steps so we can a/b test the order.",
    }),
    failStep,
  );
  await seedStep(failures, "comment.initiative2.perf", () =>
    createCommentImpl(token, {
      cardId: initiative2.id,
      body:
        "Code-split landed on staging.  p95 dropped from 380ms to 210ms — close to the goal.",
    }),
    failStep,
  );

  // ---- Checklists on a couple of stories ----
  const chk1 = await seedStep(failures, "checklist.dod", () =>
    createChecklistImpl(token, {
      cardId: stories1[0].id,
      title: "Definition of done",
    }),
    failStep,
  );
  if (chk1) {
    const items = [
      ["Wireframes approved", true],
      ["Copy reviewed", true],
      ["A/B test wired", false],
      ["Analytics events firing", false],
      ["QA pass", false],
    ] as const;
    let idx = 0;
    for (const [text, done] of items) {
      const stepIdx = idx++;
      const it = await seedStep(
        failures,
        `checklist.dod.item-${stepIdx}`,
        () => addChecklistItemImpl(token, { checklistId: chk1.id, text }),
        failStep,
      );
      if (it && done) {
        await seedStep(
          failures,
          `checklist.dod.toggle-${stepIdx}`,
          () =>
            toggleChecklistItemImpl(token, { id: it.id, completed: true }),
          failStep,
        );
      }
    }
  }
  const chk2 = await seedStep(failures, "checklist.acceptance", () =>
    createChecklistImpl(token, {
      cardId: stories1[1].id,
      title: "Acceptance",
    }),
    failStep,
  );
  if (chk2) {
    let idx = 0;
    for (const [text, done] of [
      ["Empty roadmap state", true],
      ["Empty boards state", false],
      ["Empty inbox state", false],
    ] as const) {
      const stepIdx = idx++;
      const it = await seedStep(
        failures,
        `checklist.acceptance.item-${stepIdx}`,
        () => addChecklistItemImpl(token, { checklistId: chk2.id, text }),
        failStep,
      );
      if (it && done) {
        await seedStep(
          failures,
          `checklist.acceptance.toggle-${stepIdx}`,
          () =>
            toggleChecklistItemImpl(token, { id: it.id, completed: true }),
          failStep,
        );
      }
    }
  }

  // ---- Card-link relations (dependency arrows on the roadmap) ----
  // Stories under initiative1 block the initiative itself; performance
  // work relates to the onboarding initiative (shared infra work).
  await seedStep(failures, "card-link.story0-blocks-init1", () =>
    createCardLinkImpl(token, {
      fromCardId: stories1[0].id,
      toCardId: initiative1.id,
      kind: "blocks",
    }),
    failStep,
  );
  await seedStep(failures, "card-link.story1-blocks-init1", () =>
    createCardLinkImpl(token, {
      fromCardId: stories1[1].id,
      toCardId: initiative1.id,
      kind: "blocks",
    }),
    failStep,
  );
  await seedStep(failures, "card-link.init2-relates-init1", () =>
    createCardLinkImpl(token, {
      fromCardId: initiative2.id,
      toCardId: initiative1.id,
      kind: "relates_to",
    }),
    failStep,
  );
  await seedStep(failures, "card-link.init3-blocked-by-init2", () =>
    createCardLinkImpl(token, {
      fromCardId: initiative3.id,
      toCardId: initiative2.id,
      kind: "is_blocked_by",
    }),
    failStep,
  );

  // ---- Watchers: pin the user as watcher on the headline cards so the
  //      inbox demo has signal.  toggleCardMember already auto-watches;
  //      this catches the rest. ----
  let watcherIdx = 0;
  for (const c of [initiative1.id, initiative2.id, initiative3.id]) {
    const stepIdx = watcherIdx++;
    await seedStep(
      failures,
      `watcher.initiative-${stepIdx}`,
      () => watchCardImpl(token, { cardId: c }),
      failStep,
    );
  }

  // ---- Personal dashboard ----
  const dash = await createDashboardImpl(token, {
    name: "My dashboard",
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
    type: "count",
    config: { metric: "overdue" },
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
    type: "recent_activity",
    config: { limit: 10 },
    size: "2x2",
  });
  await createGadgetImpl(token, {
    dashboardId: dash.id,
    type: "markdown_note",
    config: {
      body:
        "## Welcome\nThis workspace is fully populated so every page has something to look at:\n\n- **Roadmap** — 3 initiatives with dates and dependencies\n- **Boards** — Product OKRs / Bug triage / Daily standup\n- **My tasks** — cards owned by you across the boards\n- **Versions** — v1.0, v1.1, v2.0\n- **Inbox** — bell pulses as comments / mentions / assignments fire\n\nDelete this workspace from Settings whenever you want a clean slate.",
    },
    size: "3x2",
  });

  // ---- Workspace dashboard (shared by default with workspace members) ----
  const wsDash = await createDashboardImpl(token, {
    name: "Engineering · this sprint",
    scope: "workspace",
    workspaceId: ws.id,
  });
  await createGadgetImpl(token, {
    dashboardId: wsDash.id,
    type: "count",
    config: { metric: "open_cards" },
    size: "1x1",
  });
  await createGadgetImpl(token, {
    dashboardId: wsDash.id,
    type: "velocity",
    config: { workspaceId: ws.id, n: 6 },
    size: "2x1",
  });
  await createGadgetImpl(token, {
    dashboardId: wsDash.id,
    type: "recent_activity",
    config: { limit: 8 },
    size: "2x2",
  });

  try {
    await markOnboardingCompletedImpl(token);
  } catch {
    /* non-fatal */
  }

  return seedResult(ws.id, failures);
}

export async function seedRichDemoWorkspace() {
  await requireUser();
  const t = (await getSessionToken())!;
  const r = await seedDemoWorkspaceImpl(t, { mode: "rich" });
  revalidatePath("/");
  return r;
}
