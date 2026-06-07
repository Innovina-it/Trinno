"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markOnboardingCompleted } from "@/actions/onboarding";

/**
 * Plan #16b-γ-B (#7) — first-run tour overlay (rewritten: anchored spotlight).
 *
 * Mounted from app/(app)/layout.tsx when the user has at least one workspace
 * AND `profiles.onboarding_completed_at` is null. After first login the user
 * lands on `/w/{workspace}`, so the steps point at the controls that are
 * actually on that screen.
 *
 * The previous version pinned its card to fixed screen corners and pointed at
 * nothing. This one looks up each step's real DOM element by `data-testid`,
 * measures it with getBoundingClientRect, and cuts a spotlight hole over it
 * (a transparent box with a large box-shadow for the surrounding dim) with the
 * card + arrow glued to the element. It re-measures on scroll/resize. If a
 * step's target is missing or offscreen — e.g. the primary nav collapses into
 * a hamburger below `lg`, or the ⌘K trigger hides below `md` — that step
 * gracefully falls back to a centered card with no arrow instead of pointing
 * at empty space.
 *
 * Monochrome only, no new dependency. On Skip / Finish / Esc we call
 * `markOnboardingCompleted` (fire-and-forget) so the overlay never returns.
 */

type Step = {
  title: string;
  body: string;
  /** data-testid of the element to spotlight; omit for a centered card. */
  target?: string;
};

const STEPS: Step[] = [
  {
    title: "Welcome to Trinno.",
    body:
      "Thirty seconds to get oriented. We'll point out your workspace switcher, your boards, the roadmap, and search. You can skip anytime.",
  },
  {
    title: "Switch workspaces here.",
    body:
      "This is your workspace switcher. Every workspace you belong to lives behind it — click to jump between them.",
    target: "workspace-switcher-trigger",
  },
  {
    title: "Boards hold your work.",
    body:
      "Boards is where your lists and cards live. Open any card for subtasks, components, sprint dates, comments, watchers, and attachments.",
    target: "nav-boards",
  },
  {
    title: "Roadmap is your timeline.",
    body:
      "Roadmap lays date-bound work out as a timeline with a critical-path overlay, so you can see what's due and what blocks what.",
    target: "nav-roadmap",
  },
  {
    title: "Search jumps anywhere.",
    body:
      "Hit Search — or press ⌘K — to jump straight to any board, card, or workspace without leaving the keyboard.",
    target: "palette-trigger",
  },
];

type Rect = { top: number; left: number; width: number; height: number };
type CardPos = {
  top: number;
  left: number;
  arrow: { side: "top" | "bottom"; left: number } | null;
};

const PAD = 6; // breathing room around the spotlighted element
const GAP = 14; // distance between the spotlight and the card
const MAX_TRIES = 40; // ~660ms of rAF retries for late-mounting targets

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function TourOverlay() {
  const [stepIdx, setStepIdx] = useState(0);
  const [closed, setClosed] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardPos, setCardPos] = useState<CardPos | null>(null);
  const [ready, setReady] = useState(false);
  const [, start] = useTransition();
  const cardRef = useRef<HTMLDivElement | null>(null);

  const step = STEPS[stepIdx];

  // Resolve the current step's target rectangle. Returns true once the result
  // is settled (found a visible element, or definitively centered) so the rAF
  // retry loop can stop; false means "target expected but not in the DOM yet".
  const measure = useCallback((): boolean => {
    const s = STEPS[stepIdx];
    if (!s.target) {
      setRect(null);
      return true;
    }
    const el = document.querySelector(`[data-testid="${s.target}"]`);
    if (!el) {
      setRect(null);
      return false;
    }
    const r = el.getBoundingClientRect();
    const offscreen =
      r.width === 0 ||
      r.height === 0 ||
      r.bottom < 0 ||
      r.top > window.innerHeight ||
      r.right < 0 ||
      r.left > window.innerWidth;
    if (offscreen) {
      setRect(null);
      return true;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    return true;
  }, [stepIdx]);

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

  // Step change → reset placement, then measure (retrying for targets that
  // mount a frame or two late, e.g. the switcher which renders after the
  // nav's first client paint).
  useEffect(() => {
    if (closed) return;
    setReady(false);
    setCardPos(null);
    let raf = 0;
    let tries = 0;
    const run = () => {
      if (measure() || tries >= MAX_TRIES) return;
      tries += 1;
      raf = requestAnimationFrame(run);
    };
    run();
    return () => cancelAnimationFrame(raf);
  }, [stepIdx, closed, measure]);

  // Keep the spotlight glued to the element through scroll and resize.
  useEffect(() => {
    if (closed) return;
    let ticking = false;
    const onMove = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        measure();
      });
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [closed, measure]);

  // Place the card relative to the (possibly null) target rect. Runs after
  // paint so the card's real height is known. Always ends by marking the step
  // ready, which fades the card in and avoids a center→anchored flicker.
  useEffect(() => {
    if (closed) return;
    if (!rect) {
      setCardPos(null);
      setReady(true);
      return;
    }
    const el = cardRef.current;
    const cw = el?.offsetWidth ?? 360;
    const ch = el?.offsetHeight ?? 180;
    const spotTop = rect.top - PAD;
    const spotBottom = rect.top + rect.height + PAD;

    let side: "top" | "bottom" | null = null;
    let top = 0;
    if (window.innerHeight - spotBottom >= ch + GAP) {
      top = spotBottom + GAP;
      side = "top"; // arrow on the card's top edge, pointing up at the target
    } else if (spotTop - GAP >= ch) {
      top = spotTop - GAP - ch;
      side = "bottom"; // arrow on the card's bottom edge, pointing down
    }

    if (side === null) {
      // No vertical room either side — center it, drop the arrow.
      setCardPos(null);
      setReady(true);
      return;
    }

    const left = clamp(
      rect.left + rect.width / 2 - cw / 2,
      12,
      window.innerWidth - cw - 12,
    );
    const arrowLeft = clamp(rect.left + rect.width / 2 - left, 20, cw - 20);
    setCardPos({ top, left, arrow: { side, left: arrowLeft } });
    setReady(true);
  }, [rect, closed]);

  // Esc to skip — same effect as the X button.
  useEffect(() => {
    if (closed) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closed]);

  if (closed) return null;

  const arrowClass =
    cardPos?.arrow?.side === "bottom"
      ? "border-b border-r" // points down
      : "border-t border-l"; // points up

  return (
    <div
      data-testid="tour-overlay"
      role="region"
      aria-label="First-run tour"
      className="pointer-events-none fixed inset-0 z-30"
    >
      {/* Non-blocking: the overlay (dim + spotlight) is pointer-events-none so
          the highlighted control — and the rest of the page — stay clickable.
          Only the card below re-enables pointer events. The user advances with
          Next/Back or just clicks through. */}
      {rect ? (
        // Spotlight: a transparent box over the target, with a huge box-shadow
        // for the surrounding dim and a hairline ring on the hole.
        <div
          aria-hidden
          data-testid="tour-spotlight"
          className="pointer-events-none absolute z-40 rounded-lg border border-fg/40"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        // No target → plain dim layer behind the centered card.
        <div
          aria-hidden
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        />
      )}

      {/* Tooltip card */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`pointer-events-auto absolute z-50 glass-hi rounded-2xl p-5 transition-opacity duration-150 ${
          ready ? "opacity-100" : "opacity-0"
        } ${
          cardPos
            ? ""
            : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        }`}
        style={{
          width: "min(420px, calc(100vw - 3rem))",
          ...(cardPos ? { top: cardPos.top, left: cardPos.left } : {}),
        }}
      >
        {cardPos?.arrow && (
          <span
            aria-hidden
            className={`absolute size-3 rotate-45 border-hairline-hi bg-[color:var(--popover)] ${arrowClass}`}
            style={{
              left: cardPos.arrow.left,
              ...(cardPos.arrow.side === "top"
                ? { top: -6 }
                : { bottom: -6 }),
            }}
          />
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
        <div aria-live="polite">
          <h2 className="serif-display text-2xl text-fg leading-tight mb-2">
            {step.title}
          </h2>
          <p className="text-sm text-fg-muted leading-relaxed mb-5">
            {step.body}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={finish}>
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
              <span>{stepIdx === STEPS.length - 1 ? "Finish" : "Next"}</span>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
