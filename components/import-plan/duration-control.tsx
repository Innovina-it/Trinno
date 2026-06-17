"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { projectSpanMonths, rescalePlanDuration } from "@/lib/plan-import/rescale";
import type { ProjectPlan } from "@/lib/plan-import/types";

const COMMIT_DELAY_MS = 350;

// Project length in months, derived from the plan's date span. Editing it
// rescales every date proportionally from a fixed start. The rescale commits a
// short moment after typing stops (and on blur / Enter), so dates update live
// without losing the in-progress value. The field is not resynced from the plan
// while focused, so a debounced commit can't clobber what's being typed.
export function DurationControl({
  plan,
  onChange,
}: {
  plan: ProjectPlan;
  onChange: (p: ProjectPlan) => void;
}) {
  const span = projectSpanMonths(plan);
  const [draft, setDraft] = useState(String(span));
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values for the debounced callback (avoid stale closures).
  const planRef = useRef(plan);
  planRef.current = plan;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Resync the displayed value from the plan only when the field isn't being
  // edited (e.g. on first load, or a plan change from elsewhere).
  useEffect(() => {
    if (!focused.current) setDraft(String(span));
  }, [span]);

  useEffect(() => () => clearTimer(), []);
  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function commit(value: string) {
    const n = parseInt(value, 10);
    const p = planRef.current;
    if (Number.isFinite(n) && n >= 1 && n !== projectSpanMonths(p)) {
      onChangeRef.current(rescalePlanDuration(p, n));
    }
  }

  function onInput(value: string) {
    setDraft(value);
    clearTimer();
    timer.current = setTimeout(() => commit(value), COMMIT_DELAY_MS);
  }

  function onBlur() {
    focused.current = false;
    clearTimer();
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 1) commit(draft);
    else setDraft(String(projectSpanMonths(planRef.current))); // revert invalid
  }

  const disabled = span === 0;
  return (
    <div className="space-y-2">
      <Label>Duration</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label="Project duration in months"
          className="w-20"
          value={disabled ? "" : draft}
          disabled={disabled}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => onInput(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              clearTimer();
              commit(draft);
              e.currentTarget.blur();
            }
          }}
        />
        <span className="mono-meta text-fg-faint">months</span>
      </div>
    </div>
  );
}
