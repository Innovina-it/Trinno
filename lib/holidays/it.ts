// Italian bank holidays (festività nazionali).
// Static const — zero runtime cost, ~600 B gzipped, covers 2024–2030.
// Easter dates are pre-computed (no Meeus at runtime).
//
// Render contract: the Roadmap shades each entry's date as a vertical
// stripe in the timeline. Dates are emitted as `YYYY-MM-DD` strings;
// callers compare against UTC start-of-day so timezones never shift them.

export interface Holiday {
  /** ISO date `YYYY-MM-DD` (UTC). */
  iso: string;
  /** Italian display name. */
  name: string;
}

// Ordered chronologically for deterministic iteration.
const ENTRIES: ReadonlyArray<Holiday> = [
  // 2024
  { iso: "2024-01-01", name: "Capodanno" },
  { iso: "2024-01-06", name: "Epifania" },
  { iso: "2024-03-31", name: "Pasqua" },
  { iso: "2024-04-01", name: "Lunedì dell'Angelo" },
  { iso: "2024-04-25", name: "Festa della Liberazione" },
  { iso: "2024-05-01", name: "Festa del Lavoro" },
  { iso: "2024-06-02", name: "Festa della Repubblica" },
  { iso: "2024-08-15", name: "Ferragosto" },
  { iso: "2024-11-01", name: "Ognissanti" },
  { iso: "2024-12-08", name: "Immacolata Concezione" },
  { iso: "2024-12-25", name: "Natale" },
  { iso: "2024-12-26", name: "Santo Stefano" },

  // 2025
  { iso: "2025-01-01", name: "Capodanno" },
  { iso: "2025-01-06", name: "Epifania" },
  { iso: "2025-04-20", name: "Pasqua" },
  { iso: "2025-04-21", name: "Lunedì dell'Angelo" },
  { iso: "2025-04-25", name: "Festa della Liberazione" },
  { iso: "2025-05-01", name: "Festa del Lavoro" },
  { iso: "2025-06-02", name: "Festa della Repubblica" },
  { iso: "2025-08-15", name: "Ferragosto" },
  { iso: "2025-11-01", name: "Ognissanti" },
  { iso: "2025-12-08", name: "Immacolata Concezione" },
  { iso: "2025-12-25", name: "Natale" },
  { iso: "2025-12-26", name: "Santo Stefano" },

  // 2026
  { iso: "2026-01-01", name: "Capodanno" },
  { iso: "2026-01-06", name: "Epifania" },
  { iso: "2026-04-05", name: "Pasqua" },
  { iso: "2026-04-06", name: "Lunedì dell'Angelo" },
  { iso: "2026-04-25", name: "Festa della Liberazione" },
  { iso: "2026-05-01", name: "Festa del Lavoro" },
  { iso: "2026-06-02", name: "Festa della Repubblica" },
  { iso: "2026-08-15", name: "Ferragosto" },
  { iso: "2026-11-01", name: "Ognissanti" },
  { iso: "2026-12-08", name: "Immacolata Concezione" },
  { iso: "2026-12-25", name: "Natale" },
  { iso: "2026-12-26", name: "Santo Stefano" },

  // 2027
  { iso: "2027-01-01", name: "Capodanno" },
  { iso: "2027-01-06", name: "Epifania" },
  { iso: "2027-03-28", name: "Pasqua" },
  { iso: "2027-03-29", name: "Lunedì dell'Angelo" },
  { iso: "2027-04-25", name: "Festa della Liberazione" },
  { iso: "2027-05-01", name: "Festa del Lavoro" },
  { iso: "2027-06-02", name: "Festa della Repubblica" },
  { iso: "2027-08-15", name: "Ferragosto" },
  { iso: "2027-11-01", name: "Ognissanti" },
  { iso: "2027-12-08", name: "Immacolata Concezione" },
  { iso: "2027-12-25", name: "Natale" },
  { iso: "2027-12-26", name: "Santo Stefano" },

  // 2028
  { iso: "2028-01-01", name: "Capodanno" },
  { iso: "2028-01-06", name: "Epifania" },
  { iso: "2028-04-16", name: "Pasqua" },
  { iso: "2028-04-17", name: "Lunedì dell'Angelo" },
  { iso: "2028-04-25", name: "Festa della Liberazione" },
  { iso: "2028-05-01", name: "Festa del Lavoro" },
  { iso: "2028-06-02", name: "Festa della Repubblica" },
  { iso: "2028-08-15", name: "Ferragosto" },
  { iso: "2028-11-01", name: "Ognissanti" },
  { iso: "2028-12-08", name: "Immacolata Concezione" },
  { iso: "2028-12-25", name: "Natale" },
  { iso: "2028-12-26", name: "Santo Stefano" },

  // 2029
  { iso: "2029-01-01", name: "Capodanno" },
  { iso: "2029-01-06", name: "Epifania" },
  { iso: "2029-04-01", name: "Pasqua" },
  { iso: "2029-04-02", name: "Lunedì dell'Angelo" },
  { iso: "2029-04-25", name: "Festa della Liberazione" },
  { iso: "2029-05-01", name: "Festa del Lavoro" },
  { iso: "2029-06-02", name: "Festa della Repubblica" },
  { iso: "2029-08-15", name: "Ferragosto" },
  { iso: "2029-11-01", name: "Ognissanti" },
  { iso: "2029-12-08", name: "Immacolata Concezione" },
  { iso: "2029-12-25", name: "Natale" },
  { iso: "2029-12-26", name: "Santo Stefano" },

  // 2030
  { iso: "2030-01-01", name: "Capodanno" },
  { iso: "2030-01-06", name: "Epifania" },
  { iso: "2030-04-21", name: "Pasqua" },
  { iso: "2030-04-22", name: "Lunedì dell'Angelo" },
  { iso: "2030-04-25", name: "Festa della Liberazione" },
  { iso: "2030-05-01", name: "Festa del Lavoro" },
  { iso: "2030-06-02", name: "Festa della Repubblica" },
  { iso: "2030-08-15", name: "Ferragosto" },
  { iso: "2030-11-01", name: "Ognissanti" },
  { iso: "2030-12-08", name: "Immacolata Concezione" },
  { iso: "2030-12-25", name: "Natale" },
  { iso: "2030-12-26", name: "Santo Stefano" },
];

/** Hardcoded IT defaults. Workspaces start from this list and may
 *  override on top via `workspace_holidays`. */
export const IT_DEFAULTS: ReadonlyArray<Holiday> = ENTRIES;

// O(1) lookup map, built once at module load.
const BY_ISO: ReadonlyMap<string, string> = new Map(
  ENTRIES.map((e) => [e.iso, e.name] as const),
);

/** Format a Date as `YYYY-MM-DD` in UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Returns the holiday name for a date, or undefined. */
export function holidayName(d: Date): string | undefined {
  return BY_ISO.get(isoDate(d));
}

/**
 * Holidays whose date falls within `[start, end]` (inclusive of both
 * bounds). Iterates the static list — N is small (~12/year) so a linear
 * scan is cheaper than building a per-call structure.
 *
 * Each returned `date` is a UTC midnight Date for direct use with
 * xForDate / addDays without further coercion.
 */
export function holidaysInRange(
  start: Date,
  end: Date,
): Array<{ date: Date; name: string }> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const out: Array<{ date: Date; name: string }> = [];
  for (const entry of ENTRIES) {
    const t = Date.UTC(
      Number(entry.iso.slice(0, 4)),
      Number(entry.iso.slice(5, 7)) - 1,
      Number(entry.iso.slice(8, 10)),
    );
    if (t >= startMs && t <= endMs) {
      out.push({ date: new Date(t), name: entry.name });
    }
  }
  return out;
}
