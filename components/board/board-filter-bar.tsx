"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, useMemo } from "react";
import { useBoardStore } from "@/stores/board-store";
import {
  parseFilters,
  serializeFilters,
  isFilterActive,
  type LaneMode,
} from "@/lib/board-filters";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock,
  CalendarRange,
  ChevronDown,
  Eye,
  EyeOff,
  Filter,
  Layers,
  Tag,
  User,
  X,
} from "lucide-react";

const LANE_OPTIONS: { id: LaneMode; label: string }[] = [
  { id: "none", label: "No swimlanes" },
  { id: "assignee", label: "By assignee" },
  { id: "parent", label: "By parent" },
  { id: "label", label: "By label" },
  { id: "sprint", label: "By sprint" },
  { id: "type", label: "By type" },
];
const TYPE_OPTIONS = ["epic", "story", "task", "subtask", "bug"] as const;

export function BoardFilterBar({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const labels = useBoardStore((s) => s.labels);
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const lanes = (sp.get("lanes") as LaneMode | null) ?? "none";
  const [, start] = useTransition();
  void currentUserId;

  function update(next: typeof filters, nextLanes: LaneMode = lanes) {
    const params = serializeFilters(next);
    if (nextLanes !== "none") params.set("lanes", nextLanes);
    const qs = params.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
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
  function toggleMe() {
    update({ ...filters, assignedToMe: !filters.assignedToMe });
  }
  function toggleScheduled() {
    update({ ...filters, scheduled: !filters.scheduled });
  }
  function toggleHideCompleted() {
    update({ ...filters, hideCompleted: !filters.hideCompleted });
  }
  function clear() {
    update(
      {
        types: [],
        labelIds: [],
        due: null,
        assignedToMe: false,
        scheduled: false,
        hideCompleted: false,
      },
      "none",
    );
  }

  const active = isFilterActive(filters) || lanes !== "none";
  const filterCount =
    (filters.assignedToMe ? 1 : 0) +
    (filters.due ? 1 : 0) +
    (filters.scheduled ? 1 : 0) +
    (filters.hideCompleted ? 1 : 0) +
    filters.types.length +
    filters.labelIds.length;
  const laneLabel =
    (LANE_OPTIONS.find((l) => l.id === lanes) ?? LANE_OPTIONS[0]).label;

  return (
    <div className="inline-flex items-center gap-1.5">
      {/* Lane mode */}
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-[color:var(--surface)] px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.08)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40">
          <Layers className="size-3.5" aria-hidden />
          <span className="text-fg">{laneLabel}</span>
          <ChevronDown className="size-3 text-fg-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Swimlanes</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={lanes}
              onValueChange={(v) => update(filters, v as LaneMode)}
            >
              {LANE_OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.id} value={o.id}>
                  {o.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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
              checked={filters.assignedToMe}
              onCheckedChange={toggleMe}
            >
              <User className="size-3.5" aria-hidden />
              Assigned to me
            </DropdownMenuCheckboxItem>
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
