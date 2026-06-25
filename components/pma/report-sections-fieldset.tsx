"use client";

import {
  REPORT_SECTION_KEYS,
  REPORT_SECTION_LABELS,
} from "@/lib/pma/report-sections";
import { useReportSections } from "./report-sections-context";

// The 8 report-section checkboxes, rendered below the Documents-folder control.
// State is shared (context) with the Run button in the header, which posts the
// selection and persists it. Owner/admin only — the page gates rendering.
export function ReportSectionsFieldset({ canRun }: { canRun: boolean }) {
  const { sections, toggleSection } = useReportSections();
  return (
    <fieldset
      className="rounded-md border border-hairline px-2.5 py-2"
      data-testid="pma-sections"
    >
      <legend className="mono-meta-sm px-1 text-fg-faint">Report sections</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {REPORT_SECTION_KEYS.map((key) => (
          <label
            key={key}
            className="mono-meta-sm flex items-center gap-1.5 text-fg-muted hover:text-fg"
          >
            <input
              type="checkbox"
              checked={sections[key]}
              onChange={() => toggleSection(key)}
              disabled={!canRun}
              className="h-3.5 w-3.5 accent-fg disabled:opacity-50"
              data-testid={`pma-section-${key}`}
            />
            {REPORT_SECTION_LABELS[key]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
