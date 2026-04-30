// Plan #16b-γ-A (#3) — client-side longest-path computation over a card
// dependency DAG. We model edges blocker → blocked, then propagate the
// per-node duration along a topological order; nodes reachable on a
// longest path are returned in `critical`.
//
// Mirror trigger note: `card_links` carries both directions of the same
// dependency (a `blocks` row from A→B is mirrored as `is_blocked_by`
// from B→A). To avoid double-counting we only consume `is_blocked_by`
// edges. For an `is_blocked_by` row {from, to} the semantics are
// "from is blocked by to", so the *dependency* direction (blocker
// pointing to dependent) is `to → from`. We invert when building
// adjacency.

export type CardWithDates = {
  id: string;
  startDate: Date | null;
  targetDate: Date | null;
};

export type Link = { from: string; to: string; kind: string };

const MS_PER_DAY = 86_400_000;

function durationDays(card: CardWithDates): number {
  if (!card.startDate || !card.targetDate) return 0;
  const ms = card.targetDate.getTime() - card.startDate.getTime();
  if (ms <= 0) return 0;
  return ms / MS_PER_DAY;
}

/**
 * Returns the set of card ids that lie on at least one longest path
 * through the dependency DAG, plus the longest-path length in days.
 *
 * We use only `is_blocked_by` edges (deduped to one direction by the
 * mirror trigger). Cycles are detected by partial topological sort:
 * if any nodes remain after processing, those nodes are skipped (cycle
 * cards are conservatively excluded from the critical set).
 */
export function criticalPath(
  cards: CardWithDates[],
  links: Link[],
): { critical: Set<string>; longestDays: number } {
  if (cards.length === 0) return { critical: new Set(), longestDays: 0 };

  const ids = new Set(cards.map((c) => c.id));
  const cardById = new Map(cards.map((c) => [c.id, c] as const));

  // Build adjacency blocker → blocked from `is_blocked_by` rows.
  // Row {from, to, kind: 'is_blocked_by'} means: from is blocked by to,
  // so the dependency edge points from the BLOCKER (`to`) to the
  // DEPENDENT (`from`). Skip edges that reference cards outside our set.
  const out = new Map<string, string[]>(); // node → successors
  const inDegree = new Map<string, number>();
  for (const id of ids) {
    out.set(id, []);
    inDegree.set(id, 0);
  }
  const seen = new Set<string>();
  for (const l of links) {
    if (l.kind !== "is_blocked_by") continue;
    if (!ids.has(l.from) || !ids.has(l.to)) continue;
    // Edge: blocker (l.to) → dependent (l.from). Dedupe (a, b) pairs in
    // case of duplicate rows.
    const key = `${l.to}${l.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.get(l.to)!.push(l.from);
    inDegree.set(l.from, (inDegree.get(l.from) ?? 0) + 1);
  }

  // Topological sort (Kahn).
  const order: string[] = [];
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }
  while (queue.length > 0) {
    const n = queue.shift()!;
    order.push(n);
    for (const succ of out.get(n) ?? []) {
      const d = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, d);
      if (d === 0) queue.push(succ);
    }
  }

  // Forward pass: longest path length ending at each node, plus the
  // predecessor that achieved it (we keep ALL predecessors that tie so
  // branching critical paths are surfaced fully).
  const distTo = new Map<string, number>();
  const bestPreds = new Map<string, string[]>();
  for (const id of order) {
    const card = cardById.get(id)!;
    const dur = durationDays(card);
    let best = 0;
    let preds: string[] = [];
    // Find max distTo over incoming edges. We didn't store reverse
    // adjacency; iterate the `out` map. With <=200 cards this is cheap.
    for (const [from, succs] of out.entries()) {
      if (!succs.includes(id)) continue;
      const v = (distTo.get(from) ?? 0);
      if (v > best) {
        best = v;
        preds = [from];
      } else if (v === best && best > 0) {
        preds.push(from);
      }
    }
    distTo.set(id, best + dur);
    bestPreds.set(id, preds);
  }

  // Find global maximum end node(s).
  let longest = 0;
  for (const v of distTo.values()) if (v > longest) longest = v;
  if (longest === 0) {
    // Either no nodes scheduled, or pure cycle: nothing critical.
    return { critical: new Set(), longestDays: 0 };
  }
  const critical = new Set<string>();
  const stack: string[] = [];
  for (const [id, v] of distTo.entries()) {
    if (v === longest) {
      critical.add(id);
      stack.push(id);
    }
  }
  // Walk back through predecessors, marking every card on at least one
  // longest path.
  while (stack.length > 0) {
    const n = stack.pop()!;
    for (const p of bestPreds.get(n) ?? []) {
      if (!critical.has(p)) {
        critical.add(p);
        stack.push(p);
      }
    }
  }

  return { critical, longestDays: longest };
}
