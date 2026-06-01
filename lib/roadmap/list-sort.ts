// Pure sort logic for the roadmap list view (RoadmapListView).
//
// Kept UI-free on purpose: the component itself imports `@/components/ui/*`,
// which vitest can't transform (base-ui import-analysis), so the comparator
// lives here where it unit-tests cleanly and stays a single source of truth.

export type SortKey = "title" | "start" | "target" | "owner" | "status";
export type SortDir = "asc" | "desc";

/** Minimal card shape the comparator needs. The store card is a superset. */
export type SortableCard = {
  title: string;
  startDate: Date | string | null;
  targetDate: Date | string | null;
  completedAt: Date | string | null;
};

/**
 * Epoch-ms of a date value, accepting the three forms a card date can take
 * at runtime: a real `Date` (RSC-hydrated snapshot), an ISO string (Supabase
 * realtime payloads), or null/empty. Unparseable / empty → +Infinity so it
 * sorts LAST in an ascending comparison.
 */
export function timeOf(d: Date | string | null | undefined): number {
  if (!d) return Number.POSITIVE_INFINITY;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? Number.POSITIVE_INFINITY : dt.getTime();
}

/**
 * Compare two cards by the active column/direction.
 *   - Undated cards (start/target) ALWAYS sort last, both directions —
 *     "no date" belongs at the bottom regardless of asc/desc.
 *   - Unassigned cards (owner) flip WITH direction: asc = assigned first /
 *     unassigned last, desc = unassigned first / assigned last. With a
 *     single owner this grouping is the only thing the toggle flips.
 *   - title breaks ties, and the tiebreak follows the direction too, so
 *     desc fully reverses the order. Without it, low-cardinality columns
 *     (e.g. one distinct owner) would look identical asc vs desc.
 */
export function compareCards<T extends SortableCard>(
  a: T,
  b: T,
  key: SortKey,
  dir: SortDir,
  ownerNameOf: (c: T) => string | null,
): number {
  const mul = dir === "asc" ? 1 : -1;
  let primary = 0;
  switch (key) {
    case "title":
      primary = a.title.localeCompare(b.title);
      break;
    case "owner": {
      const oa = ownerNameOf(a);
      const ob = ownerNameOf(b);
      if (!oa !== !ob) {
        // Assigned vs unassigned: fold into `primary` (not an early return)
        // so direction flips the grouping — asc = assigned first / blanks
        // last, desc = blanks first / assigned last. With a single owner
        // this is the only thing the toggle has to flip.
        primary = oa ? -1 : 1;
        break;
      }
      primary = (oa ?? "").localeCompare(ob ?? "");
      break;
    }
    case "status":
      // incomplete (0) before complete (1) when ascending
      primary =
        Number(a.completedAt != null) - Number(b.completedAt != null);
      break;
    case "start":
    case "target": {
      const ta = timeOf(key === "start" ? a.startDate : a.targetDate);
      const tb = timeOf(key === "start" ? b.startDate : b.targetDate);
      const aEmpty = !Number.isFinite(ta);
      const bEmpty = !Number.isFinite(tb);
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1; // empty dates last
      primary = ta === tb ? 0 : ta < tb ? -1 : 1;
      break;
    }
  }
  const ranked = primary !== 0 ? primary : a.title.localeCompare(b.title);
  return ranked * mul;
}
