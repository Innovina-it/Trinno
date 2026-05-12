"use client";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  dayDiff,
  pixelsPerDay,
  startOfDay,
  type Zoom,
} from "@/lib/roadmap/dates";
import type { MilestoneRow } from "./milestone-dialog";
import { deleteMilestone } from "@/actions/milestones";
import { toast } from "sonner";

export interface MilestoneMarkersProps {
  milestones: MilestoneRow[];
  zoom: Zoom;
  gridStart: Date;
  gridEnd: Date;
  /** Full canvas height in px (from top of header to bottom of last row). */
  canvasHeight: number;
  headerHeight: number;
  /** Whether the current user may edit/delete milestones. */
  canAdmin: boolean;
  onEdit: (m: MilestoneRow) => void;
  onDeleted: (id: string) => void;
}

export function MilestoneMarkers({
  milestones,
  zoom,
  gridStart,
  gridEnd,
  canvasHeight,
  headerHeight,
  canAdmin,
  onEdit,
  onDeleted,
}: MilestoneMarkersProps) {
  const [popoverId, setPopoverId] = useState<string | null>(null);
  const ppd = pixelsPerDay(zoom);
  const totalDays = Math.max(0, dayDiff(gridStart, gridEnd));

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden={false}
      data-testid="milestone-markers"
    >
      {milestones.map((m) => {
        const mDate = startOfDay(new Date(m.date));
        const days = dayDiff(gridStart, mDate);
        if (days < 0 || days > totalDays) return null;
        const x = Math.round(days * ppd);
        const isOpen = popoverId === m.id;

        return (
          <div
            key={m.id}
            data-testid={`milestone-marker-${m.id}`}
            className="absolute top-0 pointer-events-auto"
            style={{ left: x, height: canvasHeight }}
          >
            {/* Vertical line */}
            <div
              className="absolute top-0 w-px"
              style={{
                backgroundColor: m.color,
                height: canvasHeight,
                opacity: 0.75,
              }}
            />

            {/* Top label — shown above header */}
            <button
              type="button"
              title={m.name}
              onClick={() => setPopoverId(isOpen ? null : m.id)}
              className="absolute flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap max-w-[100px] truncate cursor-pointer hover:opacity-90"
              style={{
                top: headerHeight - 20,
                left: 4,
                backgroundColor: m.color,
                color: "#fff",
              }}
            >
              {m.icon && <span className="mr-0.5">{m.icon}</span>}
              {m.name}
            </button>

            {/* Popover */}
            {isOpen && (
              <div
                className="absolute z-50 rounded-lg border border-hairline bg-[color:var(--surface)] shadow-lg p-3 w-64 space-y-1.5 pointer-events-auto"
                style={{ top: headerHeight + 4, left: 8 }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm text-fg leading-tight">
                    {m.name}
                  </p>
                  <button
                    type="button"
                    className="text-fg-faint hover:text-fg text-xs shrink-0"
                    onClick={() => setPopoverId(null)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <p className="mono-meta-sm text-fg-muted">
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(m.date))}
                </p>
                {m.description && (
                  <p className="text-xs text-fg-muted line-clamp-3">
                    {m.description}
                  </p>
                )}
                {canAdmin && (
                  <div className="flex items-center gap-2 pt-1 border-t border-hairline">
                    <button
                      type="button"
                      onClick={() => {
                        setPopoverId(null);
                        onEdit(m);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
                    >
                      <Pencil className="size-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await deleteMilestone({ id: m.id });
                          onDeleted(m.id);
                          setPopoverId(null);
                        } catch {
                          toast.error("Failed to delete milestone");
                        }
                      }}
                      className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-400"
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
