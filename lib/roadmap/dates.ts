// Plan #13 — date arithmetic for the Roadmap / Timeline view.
// All operations are in UTC so the rendered grid is the same regardless of
// the viewer's timezone. The DB stores `start_date` / `target_date` as
// timestamptz; we treat the date portion as the source of truth here.

const MS_PER_DAY = 86_400_000;

export type Zoom = "week" | "month" | "quarter";

/** Strip the time portion (UTC) — returns a new Date at 00:00:00.000Z. */
export function startOfDay(d: Date): Date {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  return out;
}

/** Add N whole calendar days (UTC). N may be negative. */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

/** Whole-day delta (b - a), rounded so DST jitter never matters. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Pixels-per-day for each zoom level. Tuned for readability + density. */
export function pixelsPerDay(zoom: Zoom): number {
  switch (zoom) {
    case "week":
      return 60;
    case "month":
      return 24;
    case "quarter":
      return 8;
  }
}

/** Snap a date back to the start of its grid period (UTC). */
export function gridStartFor(now: Date, zoom: Zoom): Date {
  const d = startOfDay(now);
  if (zoom === "week") {
    // ISO week — Monday-aligned. (d.getUTCDay() + 6) % 7 = days since Monday.
    const sinceMonday = (d.getUTCDay() + 6) % 7;
    return addDays(d, -sinceMonday);
  }
  if (zoom === "month") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  // quarter — snap to first day of Jan / Apr / Jul / Oct.
  const month = d.getUTCMonth();
  const qStart = month - (month % 3);
  return new Date(Date.UTC(d.getUTCFullYear(), qStart, 1));
}

/**
 * End of the visible grid. Always at least 6 months ahead of `start`,
 * regardless of zoom. Callers may extend further to cover specific cards.
 */
export function gridEndFor(start: Date, zoom: Zoom): Date {
  void zoom;
  return addDays(startOfDay(start), 180);
}

/** Pixel offset from `gridStart` for a given date at the given pixels-per-day. */
export function xForDate(date: Date, gridStart: Date, ppd: number): number {
  return dayDiff(gridStart, date) * ppd;
}
