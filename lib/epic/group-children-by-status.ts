import type { StatusKind } from "@/lib/status";

type CardLike = { id: string; listId: string; position: string };
type ListLike = { id: string; statusKind: StatusKind | null };

export type ChildrenByStatus<C extends CardLike> = {
  todo: C[];
  in_progress: C[];
  review: C[];
  done: C[];
  blocked: C[];
  unmapped: C[];
};

/**
 * Plan #epic-as-kanban — pure grouping for the epic-kanban view. Cards
 * whose list has a `status_kind` go into the matching bucket; everything
 * else (null status_kind, list missing during CDC race) goes into
 * `unmapped`. Each bucket is sorted by `position` ascending.
 */
export function groupChildrenByStatus<C extends CardLike>(
  children: C[],
  lists: ListLike[],
): ChildrenByStatus<C> {
  const out: ChildrenByStatus<C> = {
    todo: [], in_progress: [], review: [], done: [], blocked: [], unmapped: [],
  };
  const byId = new Map<string, ListLike>();
  for (const l of lists) byId.set(l.id, l);
  for (const c of children) {
    const l = byId.get(c.listId);
    const k = l?.statusKind ?? null;
    if (k === null) {
      out.unmapped.push(c);
    } else {
      out[k].push(c);
    }
  }
  for (const k of Object.keys(out) as Array<keyof ChildrenByStatus<C>>) {
    out[k].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  }
  return out;
}
