"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { projectSpanMonths, rescalePlanDuration } from "@/lib/plan-import/rescale";
import type { ProjectPlan } from "@/lib/plan-import/types";

// Project length in months, derived from the plan's date span. Editing it
// rescales every date proportionally from a fixed start. Local draft state so a
// rescale fires once on commit (blur / Enter), not on every keystroke.
export function DurationControl({
  plan,
  onChange,
}: {
  plan: ProjectPlan;
  onChange: (p: ProjectPlan) => void;
}) {
  const span = projectSpanMonths(plan);
  const [draft, setDraft] = useState(String(span));
  useEffect(() => setDraft(String(span)), [span]);

  const disabled = span === 0;

  function commit() {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 1 && n !== span) onChange(rescalePlanDuration(plan, n));
    else setDraft(String(span));
  }

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
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              e.currentTarget.blur();
            }
          }}
        />
        <span className="mono-meta text-fg-faint">months</span>
      </div>
    </div>
  );
}
