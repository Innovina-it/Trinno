import { eq, asc } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { workspaceHolidays } from "@/lib/db/schema";
import { IT_DEFAULTS, type Holiday } from "@/lib/holidays/it";
import { mergeHolidays, type HolidayOverride } from "@/lib/holidays/merge";

/** Raw rows from `workspace_holidays`, in iso_date asc order. */
export async function listWorkspaceHolidayOverrides(
  token: string,
  workspaceId: string,
): Promise<HolidayOverride[]> {
  const rows = await dbAsUser(token, async (tx) =>
    tx
      .select({
        isoDate: workspaceHolidays.isoDate,
        name: workspaceHolidays.name,
      })
      .from(workspaceHolidays)
      .where(eq(workspaceHolidays.workspaceId, workspaceId))
      .orderBy(asc(workspaceHolidays.isoDate)),
  );
  return rows.map((r) => ({ isoDate: r.isoDate, name: r.name }));
}

/**
 * Effective holiday list for a workspace = IT defaults merged with the
 * workspace's overrides. The Settings panel and the Roadmap both call
 * this; the merge is the single source of truth.
 */
export async function listEffectiveWorkspaceHolidays(
  token: string,
  workspaceId: string,
): Promise<Holiday[]> {
  const overrides = await listWorkspaceHolidayOverrides(token, workspaceId);
  return mergeHolidays(IT_DEFAULTS, overrides);
}

/**
 * Settings-panel view of the calendar: every preset paired with its
 * effective state, plus any pure-custom additions. Each row carries the
 * info needed to render an action row (toggle mute, rename, delete).
 */
export interface WorkspaceHolidayRow {
  /** YYYY-MM-DD. */
  isoDate: string;
  /** Display name — preset name or override name. */
  name: string;
  /** Where this row originated. */
  source: "preset" | "custom";
  /** True when an override row exists muting this preset. */
  muted: boolean;
  /** True when an override row exists and renames the preset. */
  renamed: boolean;
}

export async function listWorkspaceCalendar(
  token: string,
  workspaceId: string,
): Promise<WorkspaceHolidayRow[]> {
  const overrides = await listWorkspaceHolidayOverrides(token, workspaceId);
  const muted = new Set<string>();
  const renames = new Map<string, string>();
  const customs = new Map<string, string>();
  const presetIsos = new Set(IT_DEFAULTS.map((p) => p.iso));

  for (const o of overrides) {
    if (o.name === null) muted.add(o.isoDate);
    else if (presetIsos.has(o.isoDate)) renames.set(o.isoDate, o.name);
    else customs.set(o.isoDate, o.name);
  }

  const rows: WorkspaceHolidayRow[] = [];
  for (const p of IT_DEFAULTS) {
    rows.push({
      isoDate: p.iso,
      name: renames.get(p.iso) ?? p.name,
      source: "preset",
      muted: muted.has(p.iso),
      renamed: renames.has(p.iso),
    });
  }
  for (const [iso, name] of customs) {
    rows.push({
      isoDate: iso,
      name,
      source: "custom",
      muted: false,
      renamed: false,
    });
  }
  rows.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  return rows;
}
