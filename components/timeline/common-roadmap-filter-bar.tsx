"use client";
/**
 * Cross-workspace filter bar for /timeline.
 *
 * Mirrors the visual + URL grammar of RoadmapFilterBar but only exposes
 * filters that make sense outside a single workspace. Sprint and label
 * filters are workspace-scoped (sprint ids and label ids do not commute
 * across workspaces); overdue depends on `dueDate` which the cross-workspace
 * card payload does not carry. Type and hide-completed travel cleanly.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { CheckSquare2, ChevronDown, Filter, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseFilters, serializeFilters } from "@/lib/board-filters";

const TYPE_OPTIONS = ["task", "subtask", "bug"] as const;
type Type = (typeof TYPE_OPTIONS)[number];
const TYPE_LABEL: Record<Type, string> = {
  task: "Task",
  subtask: "Sub-task",
  bug: "Bug",
};

const PRESERVE_KEYS = ["ws", "zoom"] as const;

export function CommonRoadmapFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const [, startTransition] = useTransition();

  function update(next: typeof filters) {
    const params = serializeFilters(next);
    for (const k of PRESERVE_KEYS) {
      const v = sp.get(k);
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function toggleType(t: Type) {
    const has = filters.types.includes(t);
    update({
      ...filters,
      types: has ? filters.types.filter((x) => x !== t) : [...filters.types, t],
    });
  }
  function setHideCompleted(on: boolean) {
    update({ ...filters, hideCompleted: on });
  }
  function clearAll() {
    update({
      types: [],
      labelIds: [],
      due: null,
      assignedToMe: false,
      unassigned: false,
      scheduled: false,
      hideCompleted: false,
    });
  }

  const active = filters.types.length > 0 || filters.hideCompleted;
  const activeCount =
    filters.types.length + (filters.hideCompleted ? 1 : 0);

  return (
    <div
      className="flex items-center gap-1.5"
      data-testid="common-roadmap-filter-bar"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="common-roadmap-filter-trigger"
          data-active={active ? "true" : "false"}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] ${
            active
              ? "border-fg/40 bg-fg/10 text-fg"
              : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
          }`}
        >
          <Filter className="size-3.5" aria-hidden />
          <span className="text-fg">Filters</span>
          {activeCount > 0 && (
            <span
              aria-label={`${activeCount} active filters`}
              className="inline-flex items-center justify-center rounded-full bg-fg text-bg-deep size-4 text-[10px] font-semibold tabular-nums"
            >
              {activeCount}
            </span>
          )}
          <ChevronDown className="size-3 text-fg-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            {TYPE_OPTIONS.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={filters.types.includes(t)}
                onCheckedChange={() => toggleType(t)}
                data-testid={`common-roadmap-filter-type-${t}`}
              >
                {TYPE_LABEL[t]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={filters.hideCompleted}
            onCheckedChange={(v) => setHideCompleted(Boolean(v))}
            data-testid="common-roadmap-filter-hide-completed"
          >
            <CheckSquare2 className="size-3.5" aria-hidden />
            Hide completed
          </DropdownMenuCheckboxItem>

          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={clearAll}
                data-testid="common-roadmap-filter-clear"
                className="text-fg-muted"
              >
                <X className="size-3.5" aria-hidden />
                Clear all
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Inline summary, sm+. Mono-meta breadcrumb of the most useful flag. */}
      {filters.types.length > 0 && filters.types.length <= 2 && (
        <span
          className="hidden md:inline-flex items-center gap-1 mono-meta-sm text-fg-faint"
          aria-hidden
        >
          {filters.types.map((t) => t.toUpperCase()).join(" · ")}
        </span>
      )}
    </div>
  );
}
