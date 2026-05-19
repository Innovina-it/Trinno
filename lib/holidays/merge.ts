// Merge workspace-specific holiday overrides on top of the hardcoded
// defaults. Defaults live in lib/holidays/it.ts; this module is the
// single source of truth for "what holidays does this workspace have?".
//
// Override semantics:
//   * row with `name === null` mutes the preset for that date
//   * row with `name !== null` either adds a custom day for that date
//     OR renames the preset on that date (when iso matches a preset)
//
// The function is pure — no DB calls, no React. Caller fetches overrides
// from `lib/queries/workspace-holidays.ts` and passes them in.

import type { Holiday } from "./it";

export interface HolidayOverride {
  /** YYYY-MM-DD (UTC). */
  isoDate: string;
  /** `null` = mute preset on this date. */
  name: string | null;
}

export function mergeHolidays(
  presets: ReadonlyArray<Holiday>,
  overrides: ReadonlyArray<HolidayOverride>,
): Holiday[] {
  const muted = new Set<string>();
  const customOrRename = new Map<string, string>();
  for (const o of overrides) {
    if (o.name === null) muted.add(o.isoDate);
    else customOrRename.set(o.isoDate, o.name);
  }
  const out: Holiday[] = [];
  const seen = new Set<string>();
  for (const p of presets) {
    if (muted.has(p.iso)) continue;
    out.push({ iso: p.iso, name: customOrRename.get(p.iso) ?? p.name });
    seen.add(p.iso);
  }
  for (const [iso, name] of customOrRename) {
    if (!seen.has(iso)) out.push({ iso, name });
  }
  out.sort((a, b) => a.iso.localeCompare(b.iso));
  return out;
}

/**
 * Filter a merged holiday list to those whose date falls within
 * `[start, end]` (inclusive). Returns Date objects at UTC midnight for
 * direct use with the roadmap grid helpers.
 */
export function holidaysInRange(
  holidays: ReadonlyArray<Holiday>,
  start: Date,
  end: Date,
): Array<{ date: Date; name: string }> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const out: Array<{ date: Date; name: string }> = [];
  for (const h of holidays) {
    const t = Date.UTC(
      Number(h.iso.slice(0, 4)),
      Number(h.iso.slice(5, 7)) - 1,
      Number(h.iso.slice(8, 10)),
    );
    if (t >= startMs && t <= endMs) {
      out.push({ date: new Date(t), name: h.name });
    }
  }
  return out;
}
