import "server-only";

import { and, eq } from "drizzle-orm";

import { dbAsUser } from "@/lib/db/client";
import {
  links,
  cards,
  boards,
  cardMembers,
  milestones,
  roadmapBaselines,
  roadmapBaselineEntries,
  roadmapBaselineAssignees,
  roadmapBaselineMilestones,
} from "@/lib/db/schema";
import type {
  BaselineDetail,
  BaselineEntry,
  LiveEntry,
  LiveMilestone,
} from "@/lib/baselines/types";
import { extractDriveFileId } from "./detect";
import type { DeliverableLink } from "./detect";

// PMA U9 — RUN INPUTS (user-scoped reads for the orchestrator).
//
// Everything the run needs that lives in OUR Postgres, read as the acting user
// (dbAsUser → RLS enforced): the two Drive-folder links (source + output,
// resolved to Drive folder ids), the workspace's deliverable card-links, the
// LIVE roadmap (current cards/assignees/milestones), and the Approved roadmap
// baseline shaped as a BaselineDetail. The Drive/Gemini side (detect/analyze/
// synthesize) runs service-role and is wired separately in run.ts.

export type RunInputs = {
  // Drive folder ids parsed from the workspace links (null if a link is missing
  // or its URL is not a Drive folder — the run's precondition check uses these).
  sourceFolderId: string | null;
  outputFolderId: string | null;
  deliverableLinks: DeliverableLink[];
  live: { entries: LiveEntry[]; milestones: LiveMilestone[] };
  baseline: BaselineDetail | null;
};

// timestamptz columns come back as Date from the pg driver; the baseline/live
// shapes use ISO strings (compareToBaseline diffs string dates). Tolerant of a
// string too, in case a driver hands one back.
export function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

// Flat (cardId,userId) rows → assignees grouped by cardId.
export function groupAssignees(
  rows: { cardId: string; userId: string }[],
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const list = m.get(r.cardId);
    if (list) list.push(r.userId);
    else m.set(r.cardId, [r.userId]);
  }
  return m;
}

type RawCard = {
  cardId: string;
  title: string;
  startDate: unknown;
  targetDate: unknown;
  completedAt: unknown;
  roadmapOrder: number | null;
  sprintId: string | null;
  parentCardId: string | null;
};

// Shape card + assignee rows into BaselineEntry[] (= LiveEntry[]). Pure — used
// for BOTH the live roadmap and the baseline so the two sides are symmetric and
// compareToBaseline diffs like-for-like.
export function buildEntries(
  cardRows: RawCard[],
  assigneeRows: { cardId: string; userId: string }[],
): BaselineEntry[] {
  const byCard = groupAssignees(assigneeRows);
  return cardRows.map((c) => ({
    cardId: c.cardId,
    title: c.title,
    startDate: toIso(c.startDate),
    targetDate: toIso(c.targetDate),
    completedAt: toIso(c.completedAt),
    roadmapOrder: c.roadmapOrder,
    sprintId: c.sprintId,
    parentCardId: c.parentCardId,
    assignees: byCard.get(c.cardId) ?? [],
  }));
}

export async function getRunInputs(
  token: string,
  workspaceId: string,
): Promise<RunInputs> {
  return dbAsUser(token, async (tx) => {
    // ── Drive folder links (workspace scope; one per purpose) ────────────────
    const wsLinks = await tx
      .select({ url: links.url, purpose: links.purpose })
      .from(links)
      .where(and(eq(links.workspaceId, workspaceId), eq(links.scope, "workspace")));
    const sourceUrl = wsLinks.find((l) => l.purpose === "source")?.url ?? null;
    const reportsUrl = wsLinks.find((l) => l.purpose === "reports")?.url ?? null;

    // ── Deliverable card-links (read-only cross-ref for detect) ──────────────
    const cardLinks = await tx
      .select({ id: links.id, url: links.url })
      .from(links)
      .where(and(eq(links.workspaceId, workspaceId), eq(links.scope, "card")));
    const deliverableLinks: DeliverableLink[] = cardLinks.map((l) => ({
      id: l.id,
      url: l.url,
    }));

    // ── LIVE roadmap (current unarchived cards + assignees + milestones) ─────
    const cardRows = await tx
      .select({
        cardId: cards.id,
        title: cards.title,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
        completedAt: cards.completedAt,
        roadmapOrder: cards.roadmapOrder,
        sprintId: cards.sprintId,
        parentCardId: cards.parentCardId,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(eq(boards.workspaceId, workspaceId), eq(cards.archived, false)));
    const cardAssignees = await tx
      .select({ cardId: cardMembers.cardId, userId: cardMembers.userId })
      .from(cardMembers)
      .innerJoin(cards, eq(cards.id, cardMembers.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(eq(boards.workspaceId, workspaceId), eq(cards.archived, false)));
    const liveMsRows = await tx
      .select({ milestoneId: milestones.id, name: milestones.name, date: milestones.date })
      .from(milestones)
      .where(eq(milestones.workspaceId, workspaceId));
    const live = {
      entries: buildEntries(cardRows, cardAssignees),
      milestones: liveMsRows.map((m) => ({
        milestoneId: m.milestoneId,
        name: m.name,
        date: toIso(m.date),
      })),
    };

    // ── Approved baseline → BaselineDetail (or null) ─────────────────────────
    const [approved] = await tx
      .select()
      .from(roadmapBaselines)
      .where(
        and(
          eq(roadmapBaselines.workspaceId, workspaceId),
          eq(roadmapBaselines.isApproved, true),
        ),
      )
      .limit(1);

    let baseline: BaselineDetail | null = null;
    if (approved) {
      const bEntries = await tx
        .select()
        .from(roadmapBaselineEntries)
        .where(eq(roadmapBaselineEntries.baselineId, approved.id));
      const bAssignees = await tx
        .select({
          cardId: roadmapBaselineAssignees.cardId,
          userId: roadmapBaselineAssignees.userId,
        })
        .from(roadmapBaselineAssignees)
        .where(eq(roadmapBaselineAssignees.baselineId, approved.id));
      const bMs = await tx
        .select()
        .from(roadmapBaselineMilestones)
        .where(eq(roadmapBaselineMilestones.baselineId, approved.id));
      baseline = {
        meta: {
          id: approved.id,
          workspaceId: approved.workspaceId,
          name: approved.name,
          note: approved.note,
          createdBy: approved.createdBy,
          createdAt: toIso(approved.createdAt) ?? "",
          isApproved: approved.isApproved,
        },
        entries: buildEntries(
          bEntries.map((e) => ({
            cardId: e.cardId,
            title: e.title,
            startDate: e.startDate,
            targetDate: e.targetDate,
            completedAt: e.completedAt,
            roadmapOrder: e.roadmapOrder,
            sprintId: e.sprintId,
            parentCardId: e.parentCardId,
          })),
          bAssignees,
        ),
        milestones: bMs.map((m) => ({
          milestoneId: m.milestoneId,
          name: m.name,
          date: toIso(m.date),
        })),
      };
    }

    return {
      sourceFolderId: sourceUrl ? extractDriveFileId(sourceUrl) : null,
      outputFolderId: reportsUrl ? extractDriveFileId(reportsUrl) : null,
      deliverableLinks,
      live,
      baseline,
    };
  });
}
