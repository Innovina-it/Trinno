"use client";

import { useState } from "react";
import {
  REPORT_LENGTHS,
  REPORT_LENGTH_LABELS,
  MAX_CUSTOM_PROMPT_CHARS,
  type ReportLength,
} from "@/lib/pma/report-settings";
import { cn } from "@/lib/utils";
import { useReportSections } from "./report-sections-context";
import { ConfigRow } from "./config-row";

// 0143 — two manifest rows: how long the report runs, and an optional focus it
// emphasizes. State is shared (context) with the Run button, which posts +
// persists it. Owner/admin only — the page gates it.

// A live, one-phrase meaning for the chosen length, so the segmented control
// doesn't need a tooltip to say what it does.
const LENGTH_HINT: Record<ReportLength, string> = {
  short: "headlines only",
  medium: "balanced detail",
  long: "every file and risk",
};

export function ReportSettingsControls({ canRun }: { canRun: boolean }) {
  const { reportLength, setReportLength, customPrompt, setCustomPrompt } =
    useReportSections();
  // The focus stays a quiet one-line affordance until used, so an optional field
  // never dominates the panel. Opens automatically when a focus is already saved.
  const [focusOpen, setFocusOpen] = useState(customPrompt.trim().length > 0);

  return (
    <>
      <ConfigRow label="Length">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div
            role="group"
            aria-label="Report length"
            className="inline-flex items-center gap-0.5 rounded-full border border-[color:var(--hairline)] bg-[color:var(--bg-deep)] p-0.5"
          >
            {REPORT_LENGTHS.map((len) => {
              const active = reportLength === len;
              return (
                <button
                  key={len}
                  type="button"
                  onClick={() => setReportLength(len)}
                  disabled={!canRun}
                  aria-pressed={active}
                  data-testid={`pma-length-${len}`}
                  className={cn(
                    "h-6 rounded-full px-2.5 text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-fg/40 disabled:cursor-not-allowed disabled:opacity-40",
                    active
                      ? "bg-fg font-medium text-[color:var(--bg-deep)]"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  {REPORT_LENGTH_LABELS[len]}
                </button>
              );
            })}
          </div>
          <span className="mono-meta-sm text-fg-faint" aria-hidden>
            {LENGTH_HINT[reportLength]}
          </span>
        </div>
      </ConfigRow>

      <ConfigRow label="Focus" htmlFor={focusOpen ? "pma-custom-focus" : undefined} align={focusOpen ? "start" : "center"}>
        {focusOpen ? (
          <div className="space-y-1.5">
            <textarea
              id="pma-custom-focus"
              value={customPrompt}
              onChange={(e) =>
                setCustomPrompt(e.target.value.slice(0, MAX_CUSTOM_PROMPT_CHARS))
              }
              disabled={!canRun}
              rows={2}
              maxLength={MAX_CUSTOM_PROMPT_CHARS}
              autoFocus={customPrompt.length === 0}
              placeholder="e.g. Focus on recent changes to spine-keypoint estimation."
              data-testid="pma-custom-focus"
              className="w-full resize-y rounded-lg border border-[color:var(--hairline)] bg-[color:var(--bg-deep)] px-3 py-2 text-[0.8125rem] leading-snug text-fg-muted outline-none transition-colors placeholder:text-fg-faint focus:border-fg/40 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-fg-faint">
              Steers emphasis only; it can&rsquo;t change the facts, the reporting
              period, or who&rsquo;s credited.
            </p>
          </div>
        ) : (
          <button
            type="button"
            disabled={!canRun}
            onClick={() => setFocusOpen(true)}
            data-testid="pma-focus-add"
            className="text-[0.8125rem] text-fg-faint transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add a focus for this report
          </button>
        )}
      </ConfigRow>
    </>
  );
}
