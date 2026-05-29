import "server-only";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import {
  cardFieldHistory,
  cardSprintHistory,
  lists,
  profiles,
  sprints,
} from "@/lib/db/schema";
import type { CardHistoryRow } from "./card-history-types";

export type { CardHistoryRow };

// Merged audit feed for a single card. Combines:
//   1. `card_field_history` — every tracked field change (title, owner,
//      priority, start/target/due/completed, sprint, parent, type, points).
//   2. `card_sprint_history` — sprint-assignment open/close intervals.
// Joined to actor profiles + sprint names so the UI doesn't need a
// secondary lookup pass.
//
// RLS: dbAsUser scopes by JWT. Both tables RLS to "viewer of card".
//
// NOTE: the React client hook `useCardHistoryPaginated` lives in
// `./use-card-history.ts` so that client components don't pull
// drizzle / postgres into the browser bundle via this file.

const MAX_HISTORY_ROWS = 200;
const DEFAULT_HISTORY_PAGE_SIZE = 20;

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
    // List moves store raw list UUIDs in old_value/new_value; resolve them
    // to titles so the History feed reads "In Progress → Closed" rather
    // than two opaque ids. Collects from BOTH sides of every list_id row.
    const listIds = Array.from(
      new Set(
        fieldRows
          .filter((r) => r.field === "list_id")
          .flatMap((r) => [r.oldValue, r.newValue])
          .filter((id): id is string => id !== null && id !== ""),
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

    const listTitleRows = listIds.length
      ? await tx
          .select({ id: lists.id, title: lists.title })
          .from(lists)
          .where(inArray(lists.id, listIds))
      : [];
    const listTitleById = new Map(listTitleRows.map((r) => [r.id, r.title]));

    // Swap list UUIDs for their titles in list_id rows; leave a non-null
    // value untouched if the list was hard-deleted (no title row) so the
    // raw id still renders rather than collapsing to "—".
    const resolveListValue = (v: string | null): string | null =>
      v ? listTitleById.get(v) ?? v : v;

    const out: CardHistoryRow[] = [];
    for (const r of fieldRows) {
      const isList = r.field === "list_id";
      out.push({
        kind: "field",
        id: r.id,
        cardId: r.cardId,
        field: r.field,
        oldValue: isList ? resolveListValue(r.oldValue) : r.oldValue,
        newValue: isList ? resolveListValue(r.newValue) : r.newValue,
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

export async function listCardHistoryPage(
  token: string,
  cardId: string,
  page = 0,
  pageSize = DEFAULT_HISTORY_PAGE_SIZE,
): Promise<{ rows: CardHistoryRow[]; nextPage: number | null }> {
  const safePageSize = Math.max(1, Math.min(pageSize, MAX_HISTORY_ROWS));
  const safePage = Math.max(0, page);
  const rows = await listCardHistory(token, cardId);
  const start = safePage * safePageSize;
  const pageRows = rows.slice(start, start + safePageSize);
  return {
    rows: pageRows,
    nextPage: start + safePageSize < rows.length ? safePage + 1 : null,
  };
}

// Suppress unused-imports lint warnings if drizzle helpers vary across
// future use. `and` / `or` may be needed when we extend filtering.
void and;
void or;
