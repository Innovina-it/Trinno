// Project-duration rescaling. The plan's dates are absolute YYYY-MM-DD strings;
// the "duration" is the span from the earliest start to the latest end across
// all work packages and milestones. Changing the duration proportionally
// stretches every date from a fixed project start. Client-safe (no server-only):
// the review UI imports it.

import { isoToDate, dateToIso } from "./date-adapter";
import type { ProjectPlan } from "./types";

const DAY_MS = 86_400_000;
const AVG_MONTH_MS = 30.4375 * DAY_MS; // mean Gregorian month

function planDates(plan: ProjectPlan): Date[] {
  const out: Date[] = [];
  const push = (iso: string) => {
    const d = isoToDate(iso);
    if (d) out.push(d);
  };
  for (const wp of plan.workPackages) {
    push(wp.start);
    push(wp.end);
    for (const d of wp.deliverables) push(d.due);
  }
  for (const m of plan.milestones) push(m.date);
  return out;
}

// Whole-month span from the earliest to the latest date in the plan. 0 when the
// plan has fewer than two parseable dates (nothing to span).
export function projectSpanMonths(plan: ProjectPlan): number {
  const t = planDates(plan).map((d) => d.getTime());
  if (t.length < 2) return 0;
  const span = Math.max(...t) - Math.min(...t);
  if (span <= 0) return 0;
  return Math.max(1, Math.round(span / AVG_MONTH_MS));
}

// Return a copy of the plan with every date proportionally rescaled so its span
// becomes `newMonths`, anchored at the (unchanged) earliest start. Deliverable
// M-numbers are recomputed from their new dates. No-op when the plan can't be
// dated or `newMonths < 1`.
export function rescalePlanDuration(plan: ProjectPlan, newMonths: number): ProjectPlan {
  const t = planDates(plan).map((d) => d.getTime());
  const current = projectSpanMonths(plan);
  if (t.length < 2 || current <= 0 || newMonths < 1) return plan;

  const minStart = Math.min(...t);
  const factor = newMonths / current;

  const remap = (iso: string): string => {
    const d = isoToDate(iso);
    if (!d) return iso;
    const offsetDays = (d.getTime() - minStart) / DAY_MS;
    return dateToIso(new Date(minStart + Math.round(offsetDays * factor) * DAY_MS));
  };
  const monthFromStart = (iso: string): number => {
    const d = isoToDate(iso);
    if (!d) return 1;
    return Math.max(1, Math.round((d.getTime() - minStart) / AVG_MONTH_MS));
  };

  return {
    ...plan,
    workPackages: plan.workPackages.map((wp) => ({
      ...wp,
      start: remap(wp.start),
      end: remap(wp.end),
      deliverables: wp.deliverables.map((dl) => {
        const due = remap(dl.due);
        return { ...dl, due, month: monthFromStart(due) };
      }),
    })),
    milestones: plan.milestones.map((m) => ({ ...m, date: remap(m.date) })),
  };
}
