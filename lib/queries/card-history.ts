import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  cardFieldHistory,
  cardSprintHistory,
  profiles,
  sprints,
} from "@/lib/db/schema";

// Merged audit feed for a single card. Combines:
//   1. `card_field_history` — every tracked field change (title, owner,
//      priority, start/target/due/completed, sprint, parent, type, points).
//   2. `card_sprint_history` — sprint-assignment open/close intervals.
// Joined to actor profiles + sprint names so the UI doesn't need a
// secondary lookup pass.
//
// RLS: dbAsUser scopes by JWT. Both tables RLS to "viewer of card".

export type CardHistoryRow =
  | {
      kind: "field";
      id: string;
      cardId: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      actorId: string | null;
      actorName: string | null;
      at: Date;
    }
  | {
      kind: "sprint";
      // Sprint-assignment window. assignedAt = entered, removedAt = exited
      // (or null when still active in that sprint).
      id: string;
      cardId: string;
      sprintId: string | null;
      sprintName: string | null;
      assignedAt: Date;
      removedAt: Date | null;
      at: Date;
    };

const MAX_HISTORY_ROWS = 200;

export async function listCardHistory(
  token: string,
  cardId: string,
): Promise<CardHistoryRow[]> {
  return dbAsUser(token, async (tx) => {
    const fieldRows = await tx
      .select({
        id: cardFieldHistory.id,
        cardId: cardFieldHistory.cardId,
        field: cardFieldHistory.field,
        oldValue: cardFieldHistory.oldValue,
        newValue: cardFieldHistory.newValue,
        actorId: cardFieldHistory.actorId,
        changedAt: cardFieldHistory.changedAt,
      })
      .from(cardFieldHistory)
      .where(eq(cardFieldHistory.cardId, cardId))
      .orderBy(desc(cardFieldHistory.changedAt))
      .limit(MAX_HISTORY_ROWS);

    const sprintRows = await tx
      .select({
        id: cardSprintHistory.id,
        cardId: cardSprintHistory.cardId,
        sprintId: cardSprintHistory.sprintId,
        assignedAt: cardSprintHistory.assignedAt,
        removedAt: cardSprintHistory.removedAt,
      })
      .from(cardSprintHistory)
      .where(eq(cardSprintHistory.cardId, cardId))
      .orderBy(asc(cardSprintHistory.assignedAt));

    // Resolve actor display names + sprint names in two batched lookups.
    const actorIds = Array.from(
      new Set(
        fieldRows
          .map((r) => r.actorId)
          .filter((id): id is string => id !== null),
      ),
    );
    const sprintIds = Array.from(
      new Set(
        sprintRows
          .map((r) => r.sprintId)
          .filter((id): id is string => id !== null),
      ),
    );

    const actorRows = actorIds.length
      ? await tx
          .select({ id: profiles.id, displayName: profiles.displayName })
          .from(profiles)
          .where(inArray(profiles.id, actorIds))
      : [];
    const actorById = new Map(actorRows.map((r) => [r.id, r.displayName]));

    const sprintNameRows = sprintIds.length
      ? await tx
          .select({ id: sprints.id, name: sprints.name })
          .from(sprints)
          .where(inArray(sprints.id, sprintIds))
      : [];
    const sprintNameById = new Map(sprintNameRows.map((r) => [r.id, r.name]));

    const out: CardHistoryRow[] = [];
    for (const r of fieldRows) {
      out.push({
        kind: "field",
        id: r.id,
        cardId: r.cardId,
        field: r.field,
        oldValue: r.oldValue,
        newValue: r.newValue,
        actorId: r.actorId,
        actorName: r.actorId ? actorById.get(r.actorId) ?? null : null,
        at: r.changedAt as Date,
      });
    }
    for (const r of sprintRows) {
      out.push({
        kind: "sprint",
        id: r.id,
        cardId: r.cardId,
        sprintId: r.sprintId,
        sprintName: r.sprintId
          ? sprintNameById.get(r.sprintId) ?? null
          : null,
        assignedAt: r.assignedAt as Date,
        removedAt: (r.removedAt ?? null) as Date | null,
        at: r.assignedAt as Date,
      });
    }

    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    return out.slice(0, MAX_HISTORY_ROWS);
  });
}

// Suppress unused-imports lint warnings if drizzle helpers vary across
// future use. `and` / `or` may be needed when we extend filtering.
void and;
void or;
