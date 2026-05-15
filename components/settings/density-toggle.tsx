"use client";

import { useEffect } from "react";
import { useUserPreferences } from "@/lib/preferences/provider";

const OPTIONS: Array<{ value: "compact" | "comfortable" | "spacious"; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];

export function DensityToggle() {
  const { preferences, setPreferences } = useUserPreferences();
  const current = preferences.layoutDensity ?? "comfortable";

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-density", current);
  }, [current]);

  return (
    <section
      className="space-y-3"
      data-testid="density-toggle"
      data-density={current}
    >
      <h2 className="mono-meta text-fg-muted">Display density</h2>
      <p className="text-sm text-fg-muted">
        Adjusts spacing across cards, lists, and tables. Saved to your account
        and applied on every device.
      </p>
      <div
        role="radiogroup"
        aria-label="Display density"
        className="inline-flex rounded-lg border border-hairline overflow-hidden"
      >
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={current === opt.value}
            data-testid={`density-toggle-${opt.value}`}
            data-selected={current === opt.value ? "true" : undefined}
            onClick={() => setPreferences({ layoutDensity: opt.value })}
            className={`px-3 py-1.5 text-sm transition-colors ${
              current === opt.value
                ? "bg-[color:var(--surface-hi)] text-fg"
                : "text-fg-muted hover:bg-[color:var(--surface-strong)]"
            } not-last:border-r not-last:border-hairline`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </section>
  );
}
