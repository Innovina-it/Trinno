"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import {
  CalendarClock,
  ChevronDown,
  Filter,
  Tag,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  isFilterActive,
  parseFilters,
  serializeFilters,
} from "@/lib/board-filters";
import { useWorkspaceStore } from "@/stores/workspace-store";

const TYPE_OPTIONS = ["task", "subtask", "bug"] as const;
type Type = (typeof TYPE_OPTIONS)[number];

export function RoadmapFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(sp.toString())),
    [sp],
  );
  const sprintParam = sp.get("sprint") ?? "";
  const [, startTransition] = useTransition();

  const sprints = useWorkspaceStore((s) => s.sprints);

  function pushParams(params: URLSearchParams) {
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  function update(next: typeof filters, sprintNext: string = sprintParam) {
    const params = serializeFilters(next);
    for (const k of ["zoom", "q", "focus", "view"]) {
      const v = sp.get(k);
      if (v) params.set(k, v);
    }
    if (sprintNext) params.set("sprint", sprintNext);
    pushParams(params);
  }

  function toggleType(t: Type) {
    const has = filters.types.includes(t);
    update({
      ...filters,
      types: has ? filters.types.filter((x) => x !== t) : [...filters.types, t],
    });
  }
  function setOverdue(on: boolean) {
    update({ ...filters, due: on ? "overdue" : null });
  }
  function setSprint(id: string) {
    update(filters, id);
  }
  function clearAll() {
    update(
      {
        types: [],
        labelIds: [],
        due: null,
        assignedToMe: false,
        unassigned: false,
        scheduled: false,
        hideCompleted: false,
      },
      "",
    );
  }

  const sprintLabel =
    sprintParam === ""
      ? "Any sprint"
      : sprints.find((s) => s.id === sprintParam)?.name ?? "Sprint";

  const active = isFilterActive(filters) || sprintParam !== "";
  const activeCount =
    filters.types.length +
    (filters.due === "overdue" ? 1 : 0) +
    (sprintParam ? 1 : 0);

  return (
    <div className="flex items-center gap-1.5" data-testid="roadmap-filter-bar">
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="roadmap-filter-trigger"
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
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            {TYPE_OPTIONS.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={filters.types.includes(t)}
                onCheckedChange={() => toggleType(t)}
                data-testid={`roadmap-filter-type-${t}`}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag className="size-3.5" aria-hidden />
              <span className="flex-1">Sprint</span>
              <span className="text-fg-faint truncate max-w-[8rem]">
                {sprintLabel}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuRadioGroup
                value={sprintParam}
                onValueChange={setSprint}
              >
                <DropdownMenuRadioItem value="">
                  Any sprint
                </DropdownMenuRadioItem>
                {sprints.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id}>
                    {s.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={filters.due === "overdue"}
            onCheckedChange={(v) => setOverdue(Boolean(v))}
            data-testid="roadmap-filter-overdue"
          >
            <CalendarClock className="size-3.5" aria-hidden />
            Overdue
          </DropdownMenuCheckboxItem>

          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={clearAll}
                data-testid="roadmap-filter-clear"
                className="text-fg-muted"
              >
                <X className="size-3.5" aria-hidden />
                Clear all
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Inline summary of the most useful active filter, when small. */}
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
