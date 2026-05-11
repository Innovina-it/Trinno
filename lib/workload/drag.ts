// Pure helpers for the workload Gantt drag-to-reschedule interaction.
// Kept side-effect free so unit tests can exercise the math without
// pulling React.

const MS_DAY = 86_400_000;

export type DragMode = "move" | "resize-left" | "resize-right";

export function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_DAY);
}

export function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_DAY);
}

// Snap a pixel delta to whole-day units against the per-range pixel
// density. `Math.round` matches the convention used by the roadmap
// drag harness so dragging exactly half a day commits forward.
export function deltaPxToDays(deltaPx: number, pxPerDay: number): number {
  if (pxPerDay <= 0) return 0;
  return Math.round(deltaPx / pxPerDay);
}

// Don't allow drags to walk a card more than ~1y from where it started.
// Acts as a sanity rail: prevents a runaway pointer (e.g. user drags
// off-screen and the auto-scroll keeps shifting startClientX) from
// landing the card 50 years in the future. Roadmap doesn't need this
// because its canvas is bounded; the workload page's auto-scroll is.
const MAX_DELTA_DAYS = 365;

export function clampDeltaDays(n: number): number {
  if (n > MAX_DELTA_DAYS) return MAX_DELTA_DAYS;
  if (n < -MAX_DELTA_DAYS) return -MAX_DELTA_DAYS;
  return n;
}

export type DateSpan = { startDate: Date; targetDate: Date };

// Apply a day-delta to the span according to the drag mode. Resize modes
// clamp so start <= target — when the user drags the left edge past the
// right edge, we collapse to a single day at the target (or vice-versa
// for resize-right). This matches roadmap behaviour.
export function applyDragDelta(
  orig: DateSpan,
  mode: DragMode,
  deltaDays: number,
): DateSpan {
  const dd = clampDeltaDays(deltaDays);
  if (mode === "move") {
    return {
      startDate: addDays(orig.startDate, dd),
      targetDate: addDays(orig.targetDate, dd),
    };
  }
  if (mode === "resize-left") {
    let next = addDays(orig.startDate, dd);
    if (next.getTime() > orig.targetDate.getTime()) next = orig.targetDate;
    return { startDate: next, targetDate: orig.targetDate };
  }
  // resize-right
  let next = addDays(orig.targetDate, dd);
  if (next.getTime() < orig.startDate.getTime()) next = orig.startDate;
  return { startDate: orig.startDate, targetDate: next };
}

// ISO yyyy-mm-dd in UTC for the date-tick overlay shown during drag.
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
