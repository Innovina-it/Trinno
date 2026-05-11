import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { boards, cards } from "@/lib/db/schema";

// Plan #13 — Roadmap / Timeline / Gantt read helpers.

export type RoadmapCard = {
  id: string;
  title: string;
  type: string;
  parentCardId: string | null;
  startDate: Date;
  targetDate: Date;
  boardId: string;
  boardTitle: string;
  archived: boolean;
  // Plan #16b-γ-G G1 — manual roadmap row order. NULL = unranked.
  roadmapOrder: number | null;
  // Plan #16b-γ-G G4 — priority enum (P0-P4). NULL = unset.
  priority: "p0" | "p1" | "p2" | "p3" | "p4" | null;
  // Single-source-of-truth completion timestamp. Bars get a strikethrough
  // + dimmed treatment when this is set so completed work is visible at
  // a glance on the timeline.
  completedAt?: Date | null;
};

export type RoadmapLink = { fromId: string; toId: string };

const MAX_ROADMAP_CARDS = 200;

/**
 * Returns up to 200 cards in the workspace that have BOTH start_date and
 * target_date set (and are not archived), joined to their board title.
 * Ordered by start_date ascending.
 *
 * RLS: dbAsUser already scopes by the JWT subject; rows from boards the
 * caller cannot see are filtered out by the policy on `cards`.
 */
export async function listRoadmapCards(
  token: string,
  workspaceId: string,
): Promise<RoadmapCard[]> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        id: cards.id,
        title: cards.title,
        type: cards.type,
        parentCardId: cards.parentCardId,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
        boardId: cards.boardId,
        boardTitle: boards.title,
        archived: cards.archived,
        roadmapOrder: cards.roadmapOrder,
        priority: cards.priority,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(
          eq(boards.workspaceId, workspaceId),
          eq(cards.archived, false),
          isNotNull(cards.startDate),
          isNotNull(cards.targetDate),
        ),
      )
      .orderBy(asc(cards.startDate))
      .limit(MAX_ROADMAP_CARDS);

    return rows
      .filter((r) => r.startDate && r.targetDate)
      .map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        parentCardId: r.parentCardId,
        startDate: r.startDate as Date,
        targetDate: r.targetDate as Date,
        boardId: r.boardId,
        boardTitle: r.boardTitle,
        archived: r.archived,
        roadmapOrder: r.roadmapOrder ?? null,
        priority: r.priority ?? null,
      }));
  });
}

/**
 * Returns is_blocked_by edges between two cards in the workspace.
 * Direction: row {fromId, toId} means card `fromId` is blocked by `toId`.
 *
 * Note the mirror trigger: when a user creates a `blocks` link from A to B,
 * the trigger inserts an inverse `is_blocked_by` row from B to A — so this
 * query returns {fromId: B, toId: A} for that case.
 */
export async function listRoadmapLinks(
  token: string,
  workspaceId: string,
): Promise<RoadmapLink[]> {
  return dbAsUser(token, async (tx) => {
    const res = await tx.execute(sql`
      select cl.from_card_id as from_id, cl.to_card_id as to_id
      from public.card_links cl
      join public.cards a on a.id = cl.from_card_id
      join public.cards b on b.id = cl.to_card_id
      join public.boards ba on ba.id = a.board_id
      join public.boards bb on bb.id = b.board_id
      where cl.kind = 'is_blocked_by'
        and ba.workspace_id = ${workspaceId}
        and bb.workspace_id = ${workspaceId}
    `);
    const rows = res as unknown as Array<{ from_id: string; to_id: string }>;
    return rows.map((r) => ({ fromId: r.from_id, toId: r.to_id }));
  });
}
