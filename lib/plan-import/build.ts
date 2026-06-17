import "server-only";

import { dbAsUser } from "@/lib/db/client";
import { lists as listsTable } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

import { createWorkspaceImpl } from "@/actions/workspaces";
import { createBoardImpl, createSubboardImpl } from "@/actions/boards";
import { setListStatusKindImpl } from "@/actions/lists";
import { createCardImpl, updateCardImpl } from "@/actions/cards";
import { upsertCardLinkImpl } from "@/actions/links";
import { createMilestoneImpl } from "@/actions/milestones";

import type { ProjectPlan } from "./types";
import {
  makeDriveDocsClient,
  probeFolder,
  resolveProjectFolder,
  type DriveDocsClient,
  type ProjectIdentity,
} from "./drive-docs";
import { projectTitleFromWorkspaceName } from "./docx-template";

const PLACEHOLDER_LINK_URL = "https://www.corriere.it";
const LINK_COLOR = "#facc15";

function decodeSub(jwt: string): string {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub as string;
}

export type BuildFailure = { step: string; message: string };
export type BuildResult = {
  workspaceId: string | null;
  ok: boolean;
  partial: boolean;
  failures: BuildFailure[];
};

async function step<T>(
  failures: BuildFailure[],
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    failures.push({ step: name, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

// Both createBoardImpl(seedDefaultLists) and createSubboardImpl auto-seed the 3
// DEFAULT_LIST_TEMPLATES (Todo / In Progress / Done) but return only the board.
// Read them back in position order so we can target the Todo list and stamp
// status_kind (the auto-seeded sub-board lists have a null status_kind).
async function boardListsByPosition(token: string, boardId: string) {
  return dbAsUser(token, (tx) =>
    tx
      .select({ id: listsTable.id, statusKind: listsTable.statusKind })
      .from(listsTable)
      .where(eq(listsTable.boardId, boardId))
      .orderBy(asc(listsTable.position)),
  );
}

const STATUS_BY_INDEX = ["todo", "in_progress", "done"] as const;

async function ensureStatusKinds(token: string, boardId: string): Promise<string> {
  const rows = await boardListsByPosition(token, boardId);
  if (rows.length === 0) {
    throw new Error(`board ${boardId} has no lists to place cards in`);
  }
  for (let i = 0; i < rows.length && i < STATUS_BY_INDEX.length; i++) {
    if (rows[i].statusKind !== STATUS_BY_INDEX[i]) {
      await setListStatusKindImpl(token, { id: rows[i].id, statusKind: STATUS_BY_INDEX[i] });
    }
  }
  return rows[0].id; // the Todo list
}

export async function buildWorkspaceFromPlan(
  token: string,
  plan: ProjectPlan,
  opts: {
    driveMode?: "auto" | "manual" | "off";
    manualFolderId?: string;
    applyOwners?: boolean;
  } = {},
): Promise<BuildResult> {
  const { driveMode = "off", manualFolderId, applyOwners = true } = opts;
  const failures: BuildFailure[] = [];
  const userId = decodeSub(token);

  // Resolve where deliverable docs go. Any Drive failure drops to placeholder
  // links rather than aborting the whole import.
  //  - off:    no docs.
  //  - manual: the user's pasted folder.
  //  - auto:   a "<project>" folder created under the shared Trinno root
  //            (PLAN_IMPORT_DRIVE_ROOT); zero pasting.
  // Project identity stamped on every deliverable doc's header: the project name
  // (template H1 / page header / "Project" cell) and the partners line. Partners
  // = the distinct owners across the plan (WP leads + task owners).
  const partnerSet = new Set<string>();
  for (const wp of plan.workPackages) {
    if (wp.lead) partnerSet.add(wp.lead);
    for (const t of wp.tasks) if (t.owner) partnerSet.add(t.owner);
  }
  const project: ProjectIdentity = {
    title: projectTitleFromWorkspaceName(plan.workspaceName),
    partners: [...partnerSet].join(", "),
  };

  let drive: DriveDocsClient | null = null;
  if (driveMode === "manual" && manualFolderId) {
    const ok = await step(failures, "drive-probe", async () => {
      await probeFolder(manualFolderId);
      return true;
    });
    if (ok) drive = makeDriveDocsClient(manualFolderId, project);
  } else if (driveMode === "auto") {
    const root = process.env.PLAN_IMPORT_DRIVE_ROOT?.trim();
    if (!root) {
      failures.push({
        step: "drive-auto",
        message: "Auto Drive folder not configured (set PLAN_IMPORT_DRIVE_ROOT).",
      });
    } else {
      const projectFolderId = await step(failures, "drive-auto", async () => {
        await probeFolder(root);
        return resolveProjectFolder(root, plan.workspaceName);
      });
      if (projectFolderId) drive = makeDriveDocsClient(projectFolderId, project);
    }
  }

  const ws = await step(failures, "workspace", () =>
    createWorkspaceImpl(token, { name: plan.workspaceName }),
  );
  if (!ws) return { workspaceId: null, ok: false, partial: false, failures };

  const parent = await step(failures, "parent-board", () =>
    createBoardImpl(token, {
      workspaceId: ws.id,
      title: plan.parentBoardTitle,
      backgroundKind: "color",
      backgroundValue: "#0f0f12",
      seedDefaultLists: true,
    }),
  );
  if (!parent) return { workspaceId: ws.id, ok: false, partial: true, failures };

  const parentTodo = await ensureStatusKinds(token, parent.id);

  for (const wp of plan.workPackages) {
    // Owner = responsible partner/org (extracted, per task). Stamped onto each
    // TASK card title when the owner toggle is on, like the manual seeders. The
    // org is not an app user, so it lives in the title, not owner_id (cards stay
    // unowned). The WP anchor (overview) title is left clean.

    // 1. WP anchor card on the parent board.
    const anchor = await step(failures, `anchor:${wp.code}`, async () => {
      const c = await createCardImpl(token, {
        listId: parentTodo,
        title: wp.title,
        startDate: wp.start,
        targetDate: wp.end,
        ownerId: null,
      });
      await updateCardImpl(token, {
        id: c.id,
        type: "task",
        description: `**Work Package** · ${wp.option}${wp.lead ? ` · Leader ${wp.lead}` : ""}\n\n${wp.description}`,
      });
      return c;
    });
    if (!anchor) continue;

    // 2. Sub-board anchored 1:1 to the anchor card.
    const sub = await step(failures, `subboard:${wp.code}`, () =>
      createSubboardImpl(token, {
        parentBoardId: parent.id,
        parentCardId: anchor.id,
        title: wp.title,
      }),
    );
    if (!sub) continue;
    const subTodo = await ensureStatusKinds(token, sub.id);

    // 3. Task cards.
    const taskCards: { id: string }[] = [];
    for (const [i, t] of wp.tasks.entries()) {
      const tc = await step(failures, `task:${wp.code}.${i}`, async () => {
        const taskSuffix = applyOwners && t.owner ? ` · ${t.owner}` : "";
        const c = await createCardImpl(token, {
          listId: subTodo,
          title: `${t.title}${taskSuffix}`,
          startDate: wp.start,
          targetDate: wp.end,
          ownerId: null,
        });
        await updateCardImpl(token, {
          id: c.id,
          type: "task",
          description: `**${wp.option}**\n\n${t.description}`,
        });
        return c;
      });
      taskCards.push(tc ?? { id: "" });
    }

    // 4. Deliverable subtasks + a card-scope link (Drive doc or placeholder).
    for (const [i, d] of wp.deliverables.entries()) {
      await step(failures, `deliverable:${wp.code}.${i}`, async () => {
        const parentTask = taskCards[d.taskIndex] ?? taskCards[0];
        const parentTaskId = parentTask && parentTask.id ? parentTask.id : null;
        const startOfDueMonth = `${d.due.slice(0, 8)}01`;
        const dc = await createCardImpl(token, {
          listId: subTodo,
          title: d.title,
          startDate: startOfDueMonth,
          targetDate: d.due,
          parentCardId: parentTaskId,
          ownerId: null,
        });
        await updateCardImpl(token, {
          id: dc.id,
          type: "subtask",
          parentCardId: parentTaskId,
          description: `**Deliverable** · ${wp.code} · M${d.month}\n\n${d.description}`,
        });

        let url = PLACEHOLDER_LINK_URL;
        if (drive) {
          const { webViewLink } = await drive.createDeliverableDoc({
            wpTitle: wp.title,
            deliverableTitle: d.title,
            subtitle: [wp.lead, `M${d.month}`].filter(Boolean).join(" · "),
            project: plan.workspaceName,
            workPackage: `${wp.code} · ${wp.title}`,
            owner: wp.lead,
            milestone: `M${d.month}`,
            due: d.due,
            description: d.description,
          });
          if (webViewLink) url = webViewLink;
        }
        await upsertCardLinkImpl(token, { cardId: dc.id, url, color: LINK_COLOR });
      });
    }
  }

  // 5. Plan milestones pinned to the parent board.
  for (const [i, m] of plan.milestones.entries()) {
    await step(failures, `milestone:${i}`, () =>
      createMilestoneImpl(token, {
        workspaceId: ws.id,
        boardId: parent.id,
        name: m.name,
        date: `${m.date}T12:00:00Z`,
        description: m.description,
        createdBy: userId,
      }),
    );
  }

  return {
    workspaceId: ws.id,
    ok: failures.length === 0,
    partial: failures.length > 0,
    failures,
  };
}
