"use client";
import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useWorkspaceStore } from "@/stores/workspace-store";

// Plan #16b-γ-Master-D D1 — horizontal "sprint drop strip" mounted above the
// Kanban lists. Each band is a `useDroppable` target keyed
// `sprint-band:<sprintId>` so dnd-kit's existing DragEndEvent fires with
// `over.data.current` carrying the sprint id. Visually shows non-completed
// sprints (planned + active) as colored cells with name + date range so the
// user sees which sprint they're about to drop into.
//
// Original Master-D wording placed the bands inside the roadmap mini-map.
// The mini-map is roadmap-specific (viewport indicator + scroller tracking),
// so reusing it on Kanban would conflate roles. This is a standalone
// component that achieves the same UX without the mini-map complications.

function fmtShortDate(d: Date | string | null): string {
  if (!d) return "?";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function SprintBand({
  sprintId,
  name,
  startDate,
  endDate,
  state,
}: {
  sprintId: string;
  name: string;
  startDate: Date | string | null;
  endDate: Date | string | null;
  state: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `sprint-band:${sprintId}`,
    data: { type: "sprint-band", sprintId },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="sprint-drop-band"
      data-sprint-id={sprintId}
      data-sprint-state={state}
      className={`flex-1 min-w-[12rem] flex flex-col justify-between rounded-md px-3 py-2 border transition-colors ${
        isOver
          ? "bg-fg/15 border-fg/60 ring-2 ring-fg/40"
          : "bg-fg/[0.04] border-hairline hover:bg-fg/[0.08]"
      }`}
    >
      <div className="mono-meta-sm text-fg flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-fg/60" aria-hidden />
        <span className="truncate">{name.toUpperCase()}</span>
        {state !== "active" && (
          <span className="mono-meta-sm text-fg-faint uppercase">{state}</span>
        )}
      </div>
      <div className="mono-meta-sm text-fg-faint mt-1">
        {fmtShortDate(startDate)} {"→"} {fmtShortDate(endDate)}
      </div>
    </div>
  );
}

export function SprintDropStrip() {
  // Filter out completed sprints — only planned + active are useful drop
  // targets. (sprint_state enum: planned | active | completed)
  const allSprints = useWorkspaceStore((s) => s.sprints);
  const sprints = useMemo(
    () => allSprints.filter((sp) => sp.state !== "completed"),
    [allSprints],
  );
  if (sprints.length === 0) return null;
  return (
    <div
      data-testid="sprint-drop-strip"
      className="flex gap-2 px-2 pb-3 overflow-x-auto"
    >
      {sprints.map((s) => (
        <SprintBand
          key={s.id}
          sprintId={s.id}
          name={s.name}
          startDate={s.startDate}
          endDate={s.endDate}
          state={s.state}
        />
      ))}
    </div>
  );
}
