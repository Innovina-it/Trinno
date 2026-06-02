import type { BaselineDetail, LiveEntry, LiveMilestone, VarianceResult, CardVariance, MilestoneVariance } from "./types";
const DAY = 86400000;
function dayDelta(live: string | null, base: string | null): number | null {
  if (!live || !base) return null;
  return Math.round((Date.parse(live) - Date.parse(base)) / DAY);
}
function setDiff(a: string[], b: string[]) {
  const bs = new Set(b), as = new Set(a);
  return { added: a.filter((x) => !bs.has(x)), removed: b.filter((x) => !as.has(x)) };
}
export function compareToBaseline(
  live: { entries: LiveEntry[]; milestones: LiveMilestone[] },
  baseline: BaselineDetail,
): VarianceResult {
  const baseById = new Map(baseline.entries.map((e) => [e.cardId, e]));
  const liveById = new Map(live.entries.map((e) => [e.cardId, e]));
  const cards: CardVariance[] = [];
  for (const l of live.entries) {
    const b = baseById.get(l.cardId);
    if (!b) { cards.push({ cardId: l.cardId, title: l.title, status: "added", startDeltaDays: null, targetDeltaDays: null, durationDeltaDays: null, assigneesAdded: l.assignees, assigneesRemoved: [] }); continue; }
    const targetDeltaDays = dayDelta(l.targetDate, b.targetDate);
    const startDeltaDays = dayDelta(l.startDate, b.startDate);
    const liveDur = l.startDate && l.targetDate ? (Date.parse(l.targetDate) - Date.parse(l.startDate)) / DAY : null;
    const baseDur = b.startDate && b.targetDate ? (Date.parse(b.targetDate) - Date.parse(b.startDate)) / DAY : null;
    const durationDeltaDays = liveDur != null && baseDur != null ? Math.round(liveDur - baseDur) : null;
    const { added, removed } = setDiff(l.assignees, b.assignees);
    let status: CardVariance["status"] = "unchanged";
    if (!b.completedAt && l.completedAt) status = "completed_since";
    else if (targetDeltaDays != null && targetDeltaDays > 0) status = "slipped";
    else if (targetDeltaDays != null && targetDeltaDays < 0) status = "pulled_in";
    else if ((l.roadmapOrder ?? 0) !== (b.roadmapOrder ?? 0)) status = "reordered";
    cards.push({ cardId: l.cardId, title: l.title, status, startDeltaDays, targetDeltaDays, durationDeltaDays, assigneesAdded: added, assigneesRemoved: removed });
  }
  for (const b of baseline.entries) if (!liveById.has(b.cardId)) cards.push({ cardId: b.cardId, title: b.title, status: "removed", startDeltaDays: null, targetDeltaDays: null, durationDeltaDays: null, assigneesAdded: [], assigneesRemoved: b.assignees });
  const baseMs = new Map(baseline.milestones.map((m) => [m.milestoneId, m]));
  const liveMs = new Map(live.milestones.map((m) => [m.milestoneId, m]));
  const milestones: MilestoneVariance[] = [];
  for (const m of live.milestones) {
    const b = baseMs.get(m.milestoneId);
    if (!b) { milestones.push({ milestoneId: m.milestoneId, name: m.name, status: "added", dateDeltaDays: null }); continue; }
    const d = dayDelta(m.date, b.date);
    milestones.push({ milestoneId: m.milestoneId, name: m.name, status: d ? "moved" : "unchanged", dateDeltaDays: d });
  }
  for (const b of baseline.milestones) if (!liveMs.has(b.milestoneId)) milestones.push({ milestoneId: b.milestoneId, name: b.name, status: "removed", dateDeltaDays: null });
  const rollup = {
    slipped: cards.filter((c) => c.status === "slipped").length,
    pulledIn: cards.filter((c) => c.status === "pulled_in").length,
    added: cards.filter((c) => c.status === "added").length,
    removed: cards.filter((c) => c.status === "removed").length,
    completedSince: cards.filter((c) => c.status === "completed_since").length,
    worstSlipDays: cards.reduce((m, c) => Math.max(m, c.targetDeltaDays ?? 0), 0),
  };
  return { cards, milestones, rollup };
}
