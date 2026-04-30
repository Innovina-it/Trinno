"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, useMemo } from "react";
import { useBoardStore } from "@/stores/board-store";
import {
  parseFilters, serializeFilters, isFilterActive,
  type LaneMode,
} from "@/lib/board-filters";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock, User, Tag, X, Layers, ChevronDown,
} from "lucide-react";

const LANE_OPTIONS: { id: LaneMode; label: string }[] = [
  { id: "none",     label: "No swimlanes" },
  { id: "assignee", label: "By assignee" },
  { id: "parent",   label: "By parent" },
  { id: "label",    label: "By label" },
  { id: "sprint",   label: "By sprint" },
  { id: "type",     label: "By type" },
];

const TYPE_OPTIONS = ["epic", "story", "task", "subtask", "bug"];

export function BoardFilterBar({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const labels = useBoardStore((s) => s.labels);
  const filters = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);
  const lanes = (sp.get("lanes") as LaneMode | null) ?? "none";
  const [pending, start] = useTransition();

  function update(next: typeof filters, nextLanes: LaneMode = lanes) {
    const params = serializeFilters(next);
    if (nextLanes !== "none") params.set("lanes", nextLanes);
    const qs = params.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  function toggleType(t: string) {
    const has = filters.types.includes(t);
    update({ ...filters, types: has ? filters.types.filter((x) => x !== t) : [...filters.types, t] });
  }
  function toggleLabel(id: string) {
    const has = filters.labelIds.includes(id);
    update({ ...filters, labelIds: has ? filters.labelIds.filter((x) => x !== id) : [...filters.labelIds, id] });
  }
  function setDue(d: typeof filters.due) {
    update({ ...filters, due: filters.due === d ? null : d });
  }
  function toggleMe() {
    update({ ...filters, assignedToMe: !filters.assignedToMe });
  }
  function clear() { update({ types: [], labelIds: [], due: null, assignedToMe: false }, "none"); }

  const active = isFilterActive(filters) || lanes !== "none";
  void currentUserId; void pending;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-hairline bg-[rgb(255_255_255/0.02)]">
      {/* Swimlane mode */}
      <DropdownMenu>
        <DropdownMenuTrigger className="chip inline-flex items-center gap-1.5 hover:bg-[rgb(255_255_255/0.08)]">
          <Layers className="size-3" />
          {(LANE_OPTIONS.find((l) => l.id === lanes) ?? LANE_OPTIONS[0]).label.toUpperCase()}
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={lanes} onValueChange={(v) => update(filters, v as LaneMode)}>
            {LANE_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={o.id}>{o.label}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1 h-4 w-px bg-hairline" />

      {/* Assignee = me */}
      <button
        type="button"
        onClick={toggleMe}
        className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.assignedToMe ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
        }`}
      >
        <User className="size-3" /> ME
      </button>

      {/* Due */}
      <button
        type="button"
        onClick={() => setDue("overdue")}
        className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.due === "overdue" ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
        }`}
      >
        <CalendarClock className="size-3" /> OVERDUE
      </button>
      <button
        type="button"
        onClick={() => setDue("this-week")}
        className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
          filters.due === "this-week" ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
        }`}
      >
        <CalendarClock className="size-3" /> THIS WEEK
      </button>

      <span className="mx-1 h-4 w-px bg-hairline" />

      {/* Types */}
      {TYPE_OPTIONS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => toggleType(t)}
          className={`chip uppercase hover:bg-[rgb(255_255_255/0.08)] ${
            filters.types.includes(t) ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
          }`}
        >
          {t}
        </button>
      ))}

      {/* Labels */}
      {labels.length > 0 && <span className="mx-1 h-4 w-px bg-hairline" />}
      {labels.slice(0, 8).map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => toggleLabel(l.id)}
          className={`chip inline-flex items-center gap-1 hover:bg-[rgb(255_255_255/0.08)] ${
            filters.labelIds.includes(l.id) ? "bg-fg/10 text-fg ring-1 ring-fg/40" : ""
          }`}
          title={l.name || l.color}
        >
          <Tag className="size-3" />
          {l.name || l.color}
        </button>
      ))}

      {active && (
        <button
          type="button"
          onClick={clear}
          className="chip inline-flex items-center gap-1 ml-auto text-fg-muted hover:text-fg"
        >
          <X className="size-3" /> CLEAR
        </button>
      )}
    </div>
  );
}
