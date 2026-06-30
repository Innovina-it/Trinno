"use client";

import {
  REPORT_LENGTHS,
  REPORT_LENGTH_LABELS,
  MAX_CUSTOM_PROMPT_CHARS,
} from "@/lib/pma/report-settings";
import { cn } from "@/lib/utils";
import { useReportSections } from "./report-sections-context";

// 0143 — per-workspace synthesis settings beside the section toggles: how long the
// report should be, and a free-text focus the run emphasizes. State is shared
// (context) with the Run button, which posts + persists it. Owner/admin only —
// the page gates it.
export function ReportSettingsControls({ canRun }: { canRun: boolean }) {
  const { reportLength, setReportLength, customPrompt, setCustomPrompt } =
    useReportSections();

  return (
    <div className="space-y-3" data-testid="pma-report-settings">
      <div className="flex items-center justify-between gap-3">
        <span className="mono-meta-sm tracking-[0.14em] text-fg-faint">
          Report length
        </span>
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
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="pma-custom-focus"
          className="mono-meta-sm tracking-[0.14em] text-fg-faint"
        >
          Custom focus <span className="text-fg-faint/70">(optional)</span>
        </label>
        <textarea
          id="pma-custom-focus"
          value={customPrompt}
          onChange={(e) =>
            setCustomPrompt(e.target.value.slice(0, MAX_CUSTOM_PROMPT_CHARS))
          }
          disabled={!canRun}
          rows={2}
          maxLength={MAX_CUSTOM_PROMPT_CHARS}
          placeholder="e.g. Focus on recent changes to spine-keypoint estimation."
          data-testid="pma-custom-focus"
          className="w-full resize-y rounded-lg border border-[color:var(--hairline)] bg-[color:var(--bg-deep)] px-3 py-2 text-[0.8125rem] leading-snug text-fg-muted outline-none transition-colors placeholder:text-fg-faint focus:border-fg/40 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="text-xs text-fg-faint">
          Steers what the report emphasizes — it can&rsquo;t change the facts, the
          reporting period, or who gets credited.
        </p>
      </div>
    </div>
  );
}
