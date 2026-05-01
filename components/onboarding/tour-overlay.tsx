"use client";
import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markOnboardingCompleted } from "@/actions/onboarding";

/**
 * Plan #16b-γ-B (#7) — first-run tour overlay.
 *
 * Mounted from app/(app)/layout.tsx when the user has at least one
 * workspace AND `profiles.onboarding_completed_at` is null. Five steps
 * walk the user through workspaces → boards → card modal → roadmap +
 * dashboards. The dim layer leaves the TopNav's z-40 alone so the
 * highlighted controls stay reachable while the tour is open.
 *
 * Manual positioning + monochrome only — no floating-ui, no chroma. On
 * Skip or Finish we call `markOnboardingCompleted` so the overlay never
 * shows again. The action is fire-and-forget for the optimistic close so
 * the UI doesn't freeze on a slow network round-trip.
 */
type Placement = "center" | "top-left" | "top-right";

type Step = {
  title: string;
  body: string;
  placement: Placement;
};

const STEPS: Step[] = [
  {
    title: "Welcome to Trinnovina.",
    body:
      "30 seconds to get you oriented. We'll show you workspaces, boards, the card modal, and the roadmap & dashboards links. You can skip anytime.",
    placement: "center",
  },
  {
    title: "Your workspace.",
    body:
      "The switcher in the top nav lists every workspace you belong to. The active one is shown in italics — click it to jump between tenants.",
    placement: "top-left",
  },
  {
    title: "Boards live in workspaces.",
    body:
      "Each board has lists and cards. Hit New board to spin one up — pick a starter template (Standup, Bug triage, OKR/Sprint) or stay blank.",
    placement: "top-right",
  },
  {
    title: "Cards have everything.",
    body:
      "Open any card to find subtasks, linked issues, components, sprint dates, comments, watchers, attachments. Roadmap dates here drive the timeline view.",
    placement: "center",
  },
  {
    title: "Roadmap & dashboards.",
    body:
      "ROADMAP shows date-bound work as a timeline with critical-path overlay. DASHBOARDS hosts gadgets — open-card counts, velocity, markdown notes. Both live in the top nav.",
    placement: "top-right",
  },
];

export function TourOverlay() {
  const [stepIdx, setStepIdx] = useState(0);
  const [closed, setClosed] = useState(false);
  const [, start] = useTransition();
  const step = STEPS[stepIdx];

  // Esc to skip — same effect as the X button.
  useEffect(() => {
    if (closed) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed]);

  function finish() {
    setClosed(true);
    start(async () => {
      try {
        await markOnboardingCompleted();
      } catch {
        // Non-fatal: a re-mount will retry on next page load.
      }
    });
  }

  function next() {
    if (stepIdx === STEPS.length - 1) finish();
    else setStepIdx(stepIdx + 1);
  }

  function back() {
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }

  if (closed) return null;

  // Tooltip placement classes. The dim layer is z-30 so the z-40 TopNav
  // remains interactive (for the workspace switcher highlight to mean
  // anything). The card itself sits on z-50.
  const placementClasses: Record<Placement, string> = {
    center:
      "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
    "top-left": "left-6 top-20",
    "top-right": "right-6 top-20",
  };

  const arrowFor: Record<Placement, string> = {
    center: "",
    "top-left":
      "absolute -top-2 left-10 size-4 rotate-45 border-t border-l border-hairline-hi bg-[color:var(--bg-1)]",
    "top-right":
      "absolute -top-2 right-10 size-4 rotate-45 border-t border-l border-hairline-hi bg-[color:var(--bg-1)]",
  };

  return (
    <div
      data-testid="tour-overlay"
      role="region"
      aria-label="First-run tour"
      className="pointer-events-none fixed inset-0 z-30"
    >
      {/* Dim layer — pointer-events-none so highlighted controls stay clickable */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />

      {/* Tooltip card */}
      <div
        className={`pointer-events-auto absolute z-50 w-[min(420px,calc(100vw-3rem))] glass-strong rounded-2xl border border-hairline-hi bg-[color:var(--bg-1)] p-5 shadow-2xl ${placementClasses[step.placement]}`}
      >
        {step.placement !== "center" && (
          <span aria-hidden className={arrowFor[step.placement]} />
        )}
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="mono-meta-sm text-fg-faint tracking-[0.18em]">
            STEP {stepIdx + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip tour"
            className="text-fg-muted hover:text-fg transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <h2 className="serif-display text-2xl text-fg leading-tight mb-2">
          {step.title}
        </h2>
        <p className="text-sm text-fg-muted leading-relaxed mb-5">
          {step.body}
        </p>
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={finish}
          >
            Skip
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={back}
              disabled={stepIdx === 0}
            >
              <ChevronLeft className="size-4" />
              <span>Back</span>
            </Button>
            <Button type="button" size="sm" onClick={next}>
              <span>
                {stepIdx === STEPS.length - 1 ? "Finish" : "Next"}
              </span>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
