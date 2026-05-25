"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, useMemo } from "react";
import { useBoardStore } from "@/stores/board-store";
import {
  getAssigneeMode,
  parseFilters,
  preserveNonFilterParams,
  serializeFilters,
  isFilterActive,
} from "@/lib/board-filters";
import { useUserPreferences } from "@/lib/preferences/provider";
import { patchBoardPreferences } from "@/lib/preferences/scoped";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock,
  CalendarOff,
  CalendarRange,
  ChevronDown,
  Eye,
  EyeOff,
  Filter,
  Tag,
  X,
} from "lucide-react";

const TYPE_OPTIONS = ["task", "subtask", "bug"] as const;

export function BoardFilterBar({
  boardId,
  currentUserId,
}: {
  boardId: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { setPreferences } = useUserPreferences();
  const labels = useBoardStore((s) => s.labels);
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const [, start] = useTransition();
  void currentUserId;

  function update(next: typeof filters) {
    const params = preserveNonFilterParams(
      new URLSearchParams(sp.toString()),
      serializeFilters(next),
    );
    const qs = params.toString();
    start(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
    setPreferences((current) =>
      patchBoardPreferences(current, boardId, {
        filters: next,
        dataVisibilityFilters: { assignee: getAssigneeMode(next) },
      }),
    );
  }
  function toggleType(t: string) {
    const has = filters.types.includes(t);
    update({
      ...filters,
      types: has ? filters.types.filter((x) => x !== t) : [...filters.types, t],
    });
  }
  function toggleLabel(id: string) {
    const has = filters.labelIds.includes(id);
    update({
      ...filters,
      labelIds: has
        ? filters.labelIds.filter((x) => x !== id)
        : [...filters.labelIds, id],
    });
  }
  function setDue(d: typeof filters.due) {
    update({ ...filters, due: filters.due === d ? null : d });
  }
  function toggleScheduled() {
    update({ ...filters, scheduled: !filters.scheduled });
  }
  function toggleHideCompleted() {
    update({ ...filters, hideCompleted: !filters.hideCompleted });
  }
  function toggleShowDates() {
    update({ ...filters, showDates: !filters.showDates });
  }
  function clear() {
    update({
      types: [],
      labelIds: [],
      due: null,
      assignedToMe: false,
      unassigned: false,
      scheduled: false,
      hideCompleted: false,
      showDates: false,
    });
  }

  const active = isFilterActive(filters);
  const filterCount =
    (filters.due ? 1 : 0) +
    (filters.scheduled ? 1 : 0) +
    (filters.hideCompleted ? 1 : 0) +
    filters.types.length +
    filters.labelIds.length;

  return (
    <div className="inline-flex items-center gap-1.5">
      {/* Filters */}
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="board-filter-trigger"
          data-active={filterCount > 0 ? "true" : "false"}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] ${
            filterCount > 0
              ? "border-fg/40 bg-fg/10 text-fg"
              : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
          }`}
        >
          <Filter className="size-3.5" aria-hidden />
          <span className="text-fg">Filters</span>
          {filterCount > 0 && (
            <span
              aria-label={`${filterCount} active filters`}
              className="inline-flex items-center justify-center rounded-full bg-fg text-bg-deep size-4 text-[10px] font-semibold tabular-nums"
            >
              {filterCount}
            </span>
          )}
          <ChevronDown className="size-3 text-fg-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Scope</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={filters.due === "overdue"}
              onCheckedChange={() => setDue("overdue")}
            >
              <CalendarClock className="size-3.5" aria-hidden />
              Overdue
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.due === "this-week"}
              onCheckedChange={() => setDue("this-week")}
            >
              <CalendarClock className="size-3.5" aria-hidden />
              This week
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.scheduled}
              onCheckedChange={toggleScheduled}
            >
              <CalendarRange className="size-3.5" aria-hidden />
              Scheduled
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            {TYPE_OPTIONS.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={filters.types.includes(t)}
                onCheckedChange={() => toggleType(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>

          {labels.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Labels</DropdownMenuLabel>
                {labels.slice(0, 8).map((l) => (
                  <DropdownMenuCheckboxItem
                    key={l.id}
                    checked={filters.labelIds.includes(l.id)}
                    onCheckedChange={() => toggleLabel(l.id)}
                  >
                    <Tag className="size-3.5" aria-hidden />
                    {l.name || l.color}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}

          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={clear} className="text-fg-muted">
                <X className="size-3.5" aria-hidden />
                Clear all
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Hide-completed toggle. URL key `done=hide` matches the workload
          page convention. Default OFF — chip becomes "active" (filled)
          when completed cards are hidden. */}
      <button
        type="button"
        data-testid="board-hide-completed-toggle"
        data-active={filters.hideCompleted ? "true" : "false"}
        aria-pressed={filters.hideCompleted}
        onClick={toggleHideCompleted}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
          filters.hideCompleted
            ? "border-fg/40 bg-fg/10 text-fg"
            : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
        }`}
      >
        {filters.hideCompleted ? (
          <EyeOff className="size-3.5" aria-hidden />
        ) : (
          <Eye className="size-3.5" aria-hidden />
        )}
        <span className="text-fg">
          {filters.hideCompleted ? "Hide completed" : "Show completed"}
        </span>
      </button>

      {/* Show-dates toggle. URL key `dates=show` opts INTO showing the
          start/target chip on each card-tile. Default OFF — board cards
          stay clean. Toggling ON reveals the schedule chip. */}
      <button
        type="button"
        data-testid="board-show-dates-toggle"
        data-active={filters.showDates ? "true" : "false"}
        aria-pressed={filters.showDates}
        onClick={toggleShowDates}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
          filters.showDates
            ? "border-fg/40 bg-fg/10 text-fg"
            : "border-hairline bg-[color:var(--surface)] text-fg-muted hover:text-fg"
        }`}
      >
        {filters.showDates ? (
          <CalendarRange className="size-3.5" aria-hidden />
        ) : (
          <CalendarOff className="size-3.5" aria-hidden />
        )}
        <span className="text-fg">
          {filters.showDates ? "Show dates" : "Hide dates"}
        </span>
      </button>

      {/* Inline summary of active type filters when small. */}
      {filters.types.length > 0 && filters.types.length <= 3 && (
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
