"use client";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import {
  getAssigneeMode,
  parseFilters,
  preserveNonFilterParams,
  serializeFilters,
  withAssigneeMode,
  type AssigneeMode,
} from "@/lib/board-filters";
import { useUserPreferences } from "@/lib/preferences/provider";
import { patchBoardPreferences } from "@/lib/preferences/scoped";

// Prominent top-row assignee filter. Promoted out of the filter dropdown
// cluster so the operator's primary axis (mine vs all vs unassigned) is
// always visible. URL-backed: ?assignee=me|all|none.

// `title` carries scope context — the filter is workspace-scoped (board /
// roadmap pages live under /w/{id}), distinct from `/me` which spans all
// workspaces. Boss feedback 2026-05-13: copy must make that obvious.
const SEGMENTS: { value: AssigneeMode; label: string; title: string }[] = [
  {
    value: "me",
    label: "Mine",
    title: "Assigned to me in this workspace. /me shows all workspaces.",
  },
  {
    value: "all",
    label: "All",
    title: "Every card in this workspace, regardless of assignee.",
  },
  {
    value: "none",
    label: "Unassigned",
    title: "Cards in this workspace with no owner and no assignees.",
  },
];

export function AssigneeFilterRow({
  boardId,
  className,
  hiddenCount = 0,
}: {
  boardId?: string;
  className?: string;
  hiddenCount?: number;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const { setPreferences } = useUserPreferences();

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const mode = getAssigneeMode(filters);

  function setMode(next: AssigneeMode) {
    if (next === mode) return;
    const nextFilters = withAssigneeMode(filters, next);
    const params = preserveNonFilterParams(
      new URLSearchParams(sp.toString()),
      serializeFilters(nextFilters),
    );
    const qs = params.toString();
    // Shallow URL update: avoids RSC refetch of board-snapshot. Next 15
    // syncs window.history.replaceState with useSearchParams. Filter is
    // applied client-side, so a server roundtrip is wasted work.
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    if (boardId) {
      setPreferences((current) =>
        patchBoardPreferences(current, boardId, {
          filters: nextFilters,
          dataVisibilityFilters: { assignee: next },
        }),
      );
    }
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
        {SEGMENTS.map((seg, i) => {
          const isActive = mode === seg.value;
          // Badge UX rule: badge appears on the *inactive* chip where the
          // currently-hidden cards live. While "Mine" is active and 50 are
          // hidden, those 50 are visible under "All" → badge on All. While
          // "Unassigned" is active and N are hidden, badge on All.
          const showBadge =
            !isActive && seg.value === "all" && mode !== "all" && hiddenCount > 0;
          return (
            <button
              key={seg.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-testid={`assignee-filter-${seg.value}`}
              title={
                showBadge
                  ? `${seg.title} (+${hiddenCount} not visible under the current filter)`
                  : seg.title
              }
              onClick={() => setMode(seg.value)}
              className={[
                "relative px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40",
                i > 0 ? "border-l border-hairline" : "",
                isActive
                  ? "bg-fg/10 text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)]",
              ].join(" ")}
            >
              <span className="inline-flex items-center gap-1.5">
                {seg.label}
                {showBadge && (
                  <span
                    data-testid="assignee-filter-hidden-badge"
                    aria-label={`${hiddenCount} more not shown — switch to ${seg.label} to see them`}
                    className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-[color:var(--accent-magenta,#d97706)] text-[10px] font-semibold leading-none text-bg-deep tabular-nums"
                  >
                    {hiddenCount > 99 ? "99+" : `+${hiddenCount}`}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
