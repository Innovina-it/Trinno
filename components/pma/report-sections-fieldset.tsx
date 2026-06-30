"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import {
  REPORT_SECTION_GROUPS,
  REPORT_SECTION_LABELS,
} from "@/lib/pma/report-sections";
import { cn } from "@/lib/utils";
import { useReportSections } from "./report-sections-context";

// The "Sections" manifest row: a rail label + a plain-language summary that
// expands to the full outline of the document the run will generate (four named
// parts, each a column of headings). State is shared (context) with the Run
// button, which posts + persists the selection. Owner/admin only.
export function ReportSectionsFieldset({ canRun }: { canRun: boolean }) {
  const { sections, toggleSection, setAll } = useReportSections();
  const keys = REPORT_SECTION_GROUPS.flatMap((g) => g.keys);
  const enabled = keys.filter((k) => sections[k]).length;
  const total = keys.length;
  const none = enabled === 0;
  // Open when a custom selection is in effect so the omitted parts are visible;
  // collapsed when every section is on (nothing worth inspecting).
  const [open, setOpen] = useState(() => enabled !== total);

  const summary =
    enabled === total
      ? "All sections"
      : none
        ? "No sections selected"
        : `${enabled} of ${total} sections`;

  return (
    <div data-testid="pma-sections" className="py-3.5">
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-5 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <span className="mono-meta-sm tracking-[0.14em] text-fg-faint">
          Sections
        </span>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="pma-sections-grid"
            className="group/disc -ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            <span
              className={cn(
                "text-[0.8125rem] transition-colors",
                none
                  ? "text-[color:var(--accent-magenta)]"
                  : "text-fg-muted group-hover/disc:text-fg",
              )}
              data-testid="pma-sections-count"
            >
              {summary}
            </span>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3.5 text-fg-faint transition-transform duration-200 group-hover/disc:text-fg-muted",
                open ? "" : "-rotate-90",
              )}
            />
          </button>
          {open && (
            <div
              role="group"
              aria-label="Toggle all sections"
              className="inline-flex items-center gap-0.5 rounded-full border border-[color:var(--hairline)] bg-[color:var(--bg-deep)] p-0.5"
            >
              {(
                [
                  ["All", true],
                  ["None", false],
                ] as const
              ).map(([label, on]) => {
                const active = on ? enabled === total : none;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setAll(on)}
                    disabled={!canRun}
                    aria-pressed={active}
                    className={cn(
                      "h-6 rounded-full px-2.5 text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-fg/40 disabled:cursor-not-allowed disabled:opacity-40",
                      active
                        ? "bg-fg font-medium text-[color:var(--bg-deep)]"
                        : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div
          id="pma-sections-grid"
          className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4"
        >
          {REPORT_SECTION_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1.5">
              <div className="mono-meta-sm text-fg-faint">{group.label}</div>
              <ul className="space-y-0.5">
                {group.keys.map((key) => {
                  const on = sections[key];
                  return (
                    <li key={key}>
                      <label
                        className={cn(
                          "group flex min-h-7 items-start gap-2 rounded-md py-1 pl-1 pr-1.5 transition-colors",
                          canRun
                            ? "cursor-pointer hover:bg-[color:var(--surface)]"
                            : "cursor-not-allowed",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleSection(key)}
                          disabled={!canRun}
                          className="peer sr-only"
                          data-testid={`pma-section-${key}`}
                        />
                        <span
                          aria-hidden
                          className={cn(
                            "mt-px grid size-[15px] shrink-0 place-items-center rounded-[4px] border transition-colors",
                            on
                              ? "border-fg bg-fg"
                              : "border-[color:var(--hairline-hi)] group-hover:border-fg/50",
                            "peer-focus-visible:ring-1 peer-focus-visible:ring-fg/40",
                          )}
                        >
                          {on && (
                            <Check
                              className="size-3 text-[color:var(--bg-deep)]"
                              strokeWidth={3}
                            />
                          )}
                        </span>
                        <span
                          className={cn(
                            "text-[0.8125rem] leading-snug transition-colors",
                            on
                              ? "text-fg-muted group-hover:text-fg"
                              : "text-fg-faint group-hover:text-fg-muted",
                          )}
                        >
                          {REPORT_SECTION_LABELS[key]}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
