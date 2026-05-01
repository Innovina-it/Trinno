"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import {
  CalendarClock,
  ChevronDown,
  CircleSlash,
  Tag,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isFilterActive,
  parseFilters,
  serializeFilters,
} from "@/lib/board-filters";
import { useWorkspaceStore } from "@/stores/workspace-store";

const TYPE_OPTIONS = ["epic", "story", "task", "subtask", "bug"] as const;

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
    // Preserve non-filter params (zoom, q, focus).
    for (const k of ["zoom", "q", "focus"]) {
      const v = sp.get(k);
      if (v) params.set(k, v);
    }
    if (sprintNext) params.set("sprint", sprintNext);
    pushParams(params);
  }

  function toggleType(t: string) {
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

  function toggleMe() {
    update({ ...filters, assignedToMe: !filters.assignedToMe });
  }

  function clearAll() {
    update(
      {
        types: [],
        labelIds: [],
        due: null,
        assignedToMe: false,
        scheduled: false,
      },
      "",
    );
  }

  const sprintLabel =
    sprintParam === ""
      ? "ANY SPRINT"
      : sprints.find((s) => s.id === sprintParam)?.name?.toUpperCase() ??
        "SPRINT";

  const active = isFilterActive(filters) || sprintParam !== "";

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-1.5 border border-hairline rounded-lg bg-[rgb(255_255_255/0.02)]"
      data-testid="roadmap-filter-bar"
    >
      <span className="mono-meta-sm text-fg-faint">FILTERS</span>
      {/* Type chips */}
      <div className="flex items-center gap-1">
        {TYPE_OPTIONS.map((t) => {
          const on = filters.types.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              data-testid={`roadmap-filter-type-${t}`}
              data-active={on}
              className={`chip mono-meta-sm hover:bg-[rgb(255_255_255/0.08)] ${
                on ? "ring-1 ring-fg/40 bg-fg/10 text-fg" : ""
              }`}
            >
              {t.toUpperCase()}
            </button>
          );
        })}
      </div>

      <span className="mx-1 h-4 w-px bg-hairline" />

      {/* Sprint dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="roadmap-filter-sprint"
          className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
            sprintParam ? "ring-1 ring-fg/40 bg-fg/10 text-fg" : ""
          }`}
        >
          <Tag className="size-3" />
          {sprintLabel}
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={sprintParam}
            onValueChange={setSprint}
          >
            <DropdownMenuRadioItem value="">Any sprint</DropdownMenuRadioItem>
            {sprints.map((s) => (
              <DropdownMenuRadioItem key={s.id} value={s.id}>
                {s.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Overdue */}
      <button
        type="button"
        onClick={() => setOverdue(filters.due !== "overdue")}
        data-testid="roadmap-filter-overdue"
        data-active={filters.due === "overdue"}
        className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.due === "overdue" ? "ring-1 ring-fg/40 bg-fg/10 text-fg" : ""
        }`}
      >
        <CalendarClock className="size-3" />
        OVERDUE
      </button>

      {/* Mine — relies on board page's cardMembers, currently not in
          workspace snapshot, so the chip toggles the URL param for
          forward-compat but does not yet narrow the bars (see B-batch). */}
      <button
        type="button"
        onClick={toggleMe}
        data-testid="roadmap-filter-mine"
        data-active={filters.assignedToMe}
        title="Filter to cards assigned to me (requires workspace member data)"
        className={`chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.assignedToMe ? "ring-1 ring-fg/40 bg-fg/10 text-fg" : ""
        }`}
      >
        MINE
      </button>

      {active && (
        <button
          type="button"
          onClick={clearAll}
          data-testid="roadmap-filter-clear"
          className="ml-auto chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)] text-fg-muted"
        >
          <X className="size-3" />
          CLEAR
        </button>
      )}
      {!active && (
        <span className="ml-auto inline-flex items-center gap-1 mono-meta-sm text-fg-faint">
          <CircleSlash className="size-3" />
          NONE
        </span>
      )}
    </div>
  );
}
