import {
  eq,
  and,
  desc,
  asc,
  gte,
  lte,
  isNull,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  cards,
  boards,
  sprints,
  activity,
  profiles,
  cardMembers,
} from "@/lib/db/schema";
import { computeBurndown, computeVelocity } from "@/lib/queries/sprints-stats";

export type CountConfig = {
  what: "open_cards" | "overdue" | "my_assignments" | "completed_this_week";
  workspaceId?: string;
};

export async function resolveCount(
  token: string,
  userId: string,
  c: CountConfig,
): Promise<{ value: number; label: string }> {
  return dbAsUser(token, async (tx) => {
    const whereParts: (SQL | undefined)[] = [];
    let label = "Cards";
    switch (c.what) {
      case "open_cards":
        whereParts.push(eq(cards.archived, false));
        label = "Open cards";
        break;
      case "overdue":
        whereParts.push(
          eq(cards.archived, false),
          isNull(cards.completedAt),
          isNotNull(cards.dueDate),
          lte(cards.dueDate, new Date()),
        );
        label = "Overdue";
        break;
      case "my_assignments":
        whereParts.push(eq(cards.archived, false));
        label = "Assigned to me";
        break;
      case "completed_this_week": {
        const sevenAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        whereParts.push(
          eq(cards.archived, true),
          gte(cards.createdAt, sevenAgo),
        );
        label = "Done this week";
        break;
      }
    }

    const base = tx
      .select({ n: sql<number>`count(*)::int` })
      .from(cards)
      .$dynamic();
    let q = base;
    if (c.what === "my_assignments") {
      q = q.innerJoin(
        cardMembers,
        and(
          eq(cardMembers.cardId, cards.id),
          eq(cardMembers.userId, userId),
        ),
      );
    }
    if (c.workspaceId) {
      q = q.innerJoin(boards, eq(boards.id, cards.boardId));
      whereParts.push(eq(boards.workspaceId, c.workspaceId));
    }
    const filtered = whereParts.filter((x): x is SQL => !!x);
    const finalQuery =
      filtered.length > 0 ? q.where(and(...filtered)) : q;
    const [row] = await finalQuery;
    return { value: row?.n ?? 0, label };
  });
}

export type RecentActivityConfig = { workspaceId?: string; limit?: number };
export async function resolveRecentActivity(
  token: string,
  c: RecentActivityConfig,
) {
  return dbAsUser(token, async (tx) => {
    const base = tx
      .select({
        id: activity.id,
        type: activity.type,
        payload: activity.payload,
        createdAt: activity.createdAt,
        actorName: profiles.displayName,
      })
      .from(activity)
      .leftJoin(profiles, eq(profiles.id, activity.actorId))
      .$dynamic();
    let q = base;
    if (c.workspaceId) {
      q = q
        .innerJoin(boards, eq(boards.id, activity.boardId))
        .where(eq(boards.workspaceId, c.workspaceId));
    }
    return q.orderBy(desc(activity.createdAt)).limit(c.limit ?? 10);
  });
}

export type AssignedConfig = { workspaceId?: string };
export async function resolveAssignedToMe(
  token: string,
  userId: string,
  c: AssignedConfig,
) {
  return dbAsUser(token, async (tx) => {
    const whereParts: SQL[] = [eq(cards.archived, false)];
    if (c.workspaceId) whereParts.push(eq(boards.workspaceId, c.workspaceId));
    return tx
      .select({
        id: cards.id,
        title: cards.title,
        boardId: cards.boardId,
        dueDate: cards.dueDate,
        type: cards.type,
        boardTitle: boards.title,
      })
      .from(cards)
      .innerJoin(
        cardMembers,
        and(
          eq(cardMembers.cardId, cards.id),
          eq(cardMembers.userId, userId),
        ),
      )
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(...whereParts))
      .orderBy(asc(cards.dueDate))
      .limit(20);
  });
}

export async function resolveDueThisWeek(
  token: string,
  _userId: string,
  c: { workspaceId?: string },
) {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  return dbAsUser(token, async (tx) => {
    const whereParts: SQL[] = [
      eq(cards.archived, false),
      isNull(cards.completedAt),
      isNotNull(cards.dueDate),
      gte(cards.dueDate, now),
      lte(cards.dueDate, week),
    ];
    if (c.workspaceId) whereParts.push(eq(boards.workspaceId, c.workspaceId));
    return tx
      .select({
        id: cards.id,
        title: cards.title,
        boardId: cards.boardId,
        dueDate: cards.dueDate,
        type: cards.type,
        boardTitle: boards.title,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(...whereParts))
      .orderBy(asc(cards.dueDate))
      .limit(20);
  });
}

export async function resolveVelocity(
  token: string,
  c: { workspaceId: string; n?: number },
) {
  return computeVelocity(token, c.workspaceId, c.n ?? 6);
}

export async function resolveBurndown(
  token: string,
  c: { workspaceId: string },
) {
  const sprintId = await dbAsUser(token, async (tx) => {
    const [active] = await tx
      .select({ id: sprints.id })
      .from(sprints)
      .where(
        and(
          eq(sprints.workspaceId, c.workspaceId),
          eq(sprints.state, "active"),
        ),
      )
      .limit(1);
    return active?.id ?? null;
  });
  if (!sprintId) return null;
  return computeBurndown(token, sprintId);
}

export async function resolveCardsByType(
  token: string,
  c: { workspaceId?: string },
): Promise<Record<string, number>> {
  return dbAsUser(token, async (tx) => {
    const base = tx
      .select({
        type: cards.type,
        n: sql<number>`count(*)::int`,
      })
      .from(cards)
      .$dynamic();
    let q = base;
    const whereParts: SQL[] = [eq(cards.archived, false)];
    if (c.workspaceId) {
      q = q.innerJoin(boards, eq(boards.id, cards.boardId));
      whereParts.push(eq(boards.workspaceId, c.workspaceId));
    }
    const rows = await q.where(and(...whereParts)).groupBy(cards.type);
    const out: Record<string, number> = {
      epic: 0,
      story: 0,
      task: 0,
      subtask: 0,
      bug: 0,
    };
    for (const r of rows) out[r.type] = r.n;
    return out;
  });
}

export function resolveMarkdownNote(
  _t: string,
  c: { body?: string },
): Promise<{ body: string }> {
  return Promise.resolve({ body: c.body ?? "" });
}

// Plan #16b-β — counts of cards across the workspace by their roadmap-
// readiness state. `scheduled` includes cards with at least one of
// (start_date, target_date) set; `unscheduled` is the complement;
// `overdue` counts non-archived, not-yet-complete cards whose target
// date has already passed.
export async function resolveOnRoadmap(
  token: string,
  c: { workspaceId: string },
): Promise<{
  total: number;
  scheduled: number;
  unscheduled: number;
  overdue: number;
}> {
  return dbAsUser(token, async (tx) => {
    const rows = await tx
      .select({
        total: sql<number>`count(*)::int`,
        scheduled: sql<number>`count(*) filter (where ${cards.startDate} is not null or ${cards.targetDate} is not null)::int`,
        unscheduled: sql<number>`count(*) filter (where ${cards.startDate} is null and ${cards.targetDate} is null)::int`,
        overdue: sql<number>`count(*) filter (where ${cards.targetDate} is not null and ${cards.targetDate} < now() and ${cards.completedAt} is null)::int`,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(
        and(eq(boards.workspaceId, c.workspaceId), eq(cards.archived, false)),
      );
    return (
      rows[0] ?? { total: 0, scheduled: 0, unscheduled: 0, overdue: 0 }
    );
  });
}
