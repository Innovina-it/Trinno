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
    // User-valued fields store a raw profile UUID in old_value/new_value:
    // owner changes (0091) and assignee add/remove (0139). Collect from
    // BOTH sides so the read feed can show "Assigned Ada" instead of an
    // opaque uuid — same treatment list_id already gets below.
    const USER_VALUE_FIELDS = new Set([
      "owner_id",
      "assignee_add",
      "assignee_remove",
    ]);
    const userValueIds = Array.from(
      new Set(
        fieldRows
          .filter((r) => USER_VALUE_FIELDS.has(r.field))
          .flatMap((r) => [r.oldValue, r.newValue])
          .filter((id): id is string => id !== null && id !== ""),
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

    // One batched profile lookup covering both actors (who made the
    // change) and user-valued fields (owner / assignee values).
    const profileIds = Array.from(new Set([...actorIds, ...userValueIds]));
    const profileRows = profileIds.length
      ? await tx
          .select({ id: profiles.id, displayName: profiles.displayName })
          .from(profiles)
          .where(inArray(profiles.id, profileIds))
      : [];
    const nameById = new Map(profileRows.map((r) => [r.id, r.displayName]));
    const actorById = nameById;

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
    // Swap a profile UUID for its display name; leave a non-null value
    // untouched if the profile was hard-deleted so the raw id still
    // renders rather than collapsing to "—".
    const resolveUserValue = (v: string | null): string | null =>
      v ? nameById.get(v) ?? v : v;

    const out: CardHistoryRow[] = [];
    for (const r of fieldRows) {
      const isList = r.field === "list_id";
      const isUser = USER_VALUE_FIELDS.has(r.field);
      const resolve = isList
        ? resolveListValue
        : isUser
          ? resolveUserValue
          : (v: string | null) => v;
      out.push({
        kind: "field",
        id: r.id,
        cardId: r.cardId,
        field: r.field,
        oldValue: resolve(r.oldValue),
        newValue: resolve(r.newValue),
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
