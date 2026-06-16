"use client";

import { cn } from "@/lib/utils";

export type WizardPhase = "upload" | "review" | "build";

const STEPS: { key: WizardPhase; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "review", label: "Review" },
  { key: "build", label: "Build" },
];

// Monochrome step indicator. State is carried by ink weight + dot fill only
// (Idle Mute Rule): current = full ink, done = muted, upcoming = faint. No color.
export function WizardStepper({ current }: { current: WizardPhase }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-3" aria-label="Import steps">
      {STEPS.map((step, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "upcoming";
        return (
          <li key={step.key} className="flex items-center gap-3">
            <span
              className="flex items-center gap-2"
              aria-current={state === "current" ? "step" : undefined}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full transition-colors duration-200",
                  state === "current" && "bg-fg",
                  state === "done" && "bg-fg/50",
                  state === "upcoming" && "bg-fg/20",
                )}
              />
              <span
                className={cn(
                  "mono-meta transition-colors duration-200",
                  state === "current" && "text-fg",
                  state === "done" && "text-fg-muted",
                  state === "upcoming" && "text-fg-faint",
                )}
              >
                {step.label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span className="h-px w-8 bg-[color:var(--hairline)]" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
