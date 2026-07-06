// PMA — period presets for the Run-analysis panel. Pure (no React, no server
// deps) so the date logic is unit-testable; the workbench component renders it.
//
// U4 (eval #1/P3) — presets were pure calendar arithmetic (This month / Last
// month / Quarter / YTD), blind to the project: the reviewed ARISE run used the
// YTD preset and reported a window that largely predates the project's first
// activity ("It should follow the strating and ending time of project"). When
// the workspace's roadmap carries dates, a "Project" preset (project start →
// today) is offered FIRST.

export type Preset = { label: string; start: Date; target: Date };
export type PresetRange = { start: Date | null; target: Date | null };
export type ProjectRange = { start: string | null; end: string | null };

export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function buildPresets(
  now: Date,
  projectRange?: ProjectRange | null,
): Preset[] {
  const t = startOfDayUTC(now);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const presets: Preset[] = [];
  // Project timeline first: roadmap start → today (a future-start project would
  // yield an empty window, so it only shows once the start is in the past).
  if (projectRange?.start) {
    const ps = new Date(projectRange.start);
    if (!Number.isNaN(ps.getTime())) {
      const start = startOfDayUTC(ps);
      if (start.getTime() <= t.getTime()) {
        presets.push({ label: "Project", start, target: t });
      }
    }
  }
  presets.push(
    { label: "This month", start: new Date(Date.UTC(y, m, 1)), target: t },
    { label: "Last month", start: new Date(Date.UTC(y, m - 1, 1)), target: new Date(Date.UTC(y, m, 0)) },
    { label: "Quarter", start: new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1)), target: t },
    { label: "YTD", start: new Date(Date.UTC(y, 0, 1)), target: t },
  );
  return presets;
}

// U7a (eval R4-1, "it should follow the starting and ending time of project") —
// the panel's DEFAULT window is the project's own timeline (roadmap start →
// today) whenever the roadmap carries a usable past start date; otherwise the
// previous default (whole document — both bounds null) is preserved.
export function defaultRange(
  projectRange: ProjectRange | null | undefined,
  now: Date,
): PresetRange {
  const project = buildPresets(now, projectRange).find((p) => p.label === "Project");
  return project
    ? { start: project.start, target: project.target }
    : { start: null, target: null };
}

export function rangeMatches(v: PresetRange, p: Preset): boolean {
  return (
    !!v.start &&
    !!v.target &&
    v.start.getTime() === p.start.getTime() &&
    v.target.getTime() === p.target.getTime()
  );
}
