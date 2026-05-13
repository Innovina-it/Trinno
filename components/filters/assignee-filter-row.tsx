"use client";
import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import {
  getAssigneeMode,
  parseFilters,
  serializeFilters,
  withAssigneeMode,
  type AssigneeMode,
} from "@/lib/board-filters";

// Prominent top-row assignee filter. Promoted out of the filter dropdown
// cluster so the operator's primary axis (mine vs all vs unassigned) is
// always visible. URL-backed: ?assignee=me|all|none.

const SEGMENTS: { value: AssigneeMode; label: string }[] = [
  { value: "me", label: "Mine" },
  { value: "all", label: "All" },
  { value: "none", label: "Unassigned" },
];

export function AssigneeFilterRow({
  className,
}: {
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const mode = getAssigneeMode(filters);

  function setMode(next: AssigneeMode) {
    if (next === mode) return;
    const params = serializeFilters(withAssigneeMode(filters, next));
    // Preserve any non-filter params already on the URL (lanes, zoom, view).
    for (const [k, v] of sp.entries()) {
      if (!params.has(k)) params.set(k, v);
    }
    const qs = params.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <div
      role="group"
      aria-label="Assignee filter"
      data-testid="assignee-filter-row"
      className={[
        "flex items-center gap-2",
        className ?? "",
      ].join(" ")}
    >
      <span className="mono-meta-sm text-fg-faint inline-flex items-center gap-1.5">
        <UserRound className="size-3" aria-hidden />
        SHOWING
      </span>
      <div className="inline-flex items-center rounded-full border border-hairline bg-[color:var(--surface)] overflow-hidden">
        {SEGMENTS.map((seg, i) => (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-checked={mode === seg.value}
            data-testid={`assignee-filter-${seg.value}`}
            onClick={() => setMode(seg.value)}
            className={[
              "px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40",
              i > 0 ? "border-l border-hairline" : "",
              mode === seg.value
                ? "bg-fg/10 text-fg font-medium"
                : "text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]",
            ].join(" ")}
          >
            {seg.label}
          </button>
        ))}
      </div>
    </div>
  );
}
