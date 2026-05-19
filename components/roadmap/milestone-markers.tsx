"use client";
import { useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  addDays,
  dayDiff,
  pixelsPerDay,
  startOfDay,
  type Zoom,
} from "@/lib/roadmap/dates";
import type { MilestoneRow } from "./milestone-dialog";
import { deleteMilestone, updateMilestone } from "@/actions/milestones";
import { toast } from "sonner";

export interface MilestoneMarkersProps {
  milestones: MilestoneRow[];
  zoom: Zoom;
  /** Resolved pixels-per-day. Required when zoom="fit"; falls back to
   *  `pixelsPerDay(zoom)` otherwise. */
  ppd?: number;
  gridStart: Date;
  gridEnd: Date;
  /** Full canvas height in px (from top of header to bottom of last row). */
  canvasHeight: number;
  headerHeight: number;
  /** Whether the current user may edit/delete milestones. */
  canAdmin: boolean;
  /** Earliest task start date across the relevant scope. A milestone may
   *  not be dragged before this date. Null = no constraint. */
  minDate?: Date | null;
  onEdit: (m: MilestoneRow) => void;
  onDeleted: (id: string) => void;
  /** Called with an optimistic row on drop, then again with the persisted
   *  row from the server. On error, called with the original row to revert. */
  onChanged?: (m: MilestoneRow) => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const CLICK_THRESHOLD_PX = 4;

export function MilestoneMarkers({
  milestones,
  zoom,
  ppd: ppdProp,
  gridStart,
  gridEnd,
  canvasHeight,
  headerHeight,
  canAdmin,
  minDate,
  onEdit,
  onDeleted,
  onChanged,
}: MilestoneMarkersProps) {
  const [popoverId, setPopoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    startClientX: number;
    originalDate: Date;
    previewDate: Date;
    moved: boolean;
  } | null>(null);
  const fallbackPpd = pixelsPerDay(zoom);
  const ppd = ppdProp && ppdProp > 0 ? ppdProp : fallbackPpd;
  const totalDays = Math.max(0, dayDiff(gridStart, gridEnd));
  const minDay = minDate ? startOfDay(minDate) : null;
  const dragRef = useRef(drag);
  dragRef.current = drag;

  function startDrag(e: React.PointerEvent, m: MilestoneRow) {
    if (!ppd || ppd <= 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({
      id: m.id,
      startClientX: e.clientX,
      originalDate: startOfDay(new Date(m.date)),
      previewDate: startOfDay(new Date(m.date)),
      moved: false,
    });
  }

  function moveDrag(e: React.PointerEvent, m: MilestoneRow) {
    const d = dragRef.current;
    if (!d || d.id !== m.id) return;
    const deltaPx = e.clientX - d.startClientX;
    const deltaDays = Math.round(deltaPx / ppd);
    let next = addDays(d.originalDate, deltaDays);
    if (minDay && next.getTime() < minDay.getTime()) next = minDay;
    setDrag({
      ...d,
      previewDate: next,
      moved: d.moved || Math.abs(deltaPx) >= CLICK_THRESHOLD_PX,
    });
  }

  async function endDrag(e: React.PointerEvent, m: MilestoneRow) {
    const d = dragRef.current;
    if (!d || d.id !== m.id) return;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {/* noop */}
    const final = d.previewDate;
    const original = d.originalDate;
    const moved = d.moved;
    setDrag(null);
    if (!moved) {
      // Treat as click — toggle popover.
      setPopoverId((prev) => (prev === m.id ? null : m.id));
      return;
    }
    if (final.getTime() === original.getTime()) return;

    const iso = toIsoDate(final);
    // Optimistic update.
    onChanged?.({ ...m, date: iso });
    try {
      const row = await updateMilestone({ id: m.id, date: iso });
      onChanged?.(row as MilestoneRow);
    } catch {
      onChanged?.({ ...m, date: toIsoDate(original) });
      toast.error("Failed to move milestone");
    }
  }

  function cancelDrag(m: MilestoneRow) {
    const d = dragRef.current;
    if (!d || d.id !== m.id) return;
    setDrag(null);
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden={false}
      data-testid="milestone-markers"
    >
      {milestones.map((m) => {
        const isDragging = drag?.id === m.id;
        const renderDate = isDragging ? drag!.previewDate : startOfDay(new Date(m.date));
        const days = dayDiff(gridStart, renderDate);
        if (days < 0 || days >= totalDays) return null;
        // Render line at end of milestone day, not start.
        const x = Math.round((days + 1) * ppd);
        const isOpen = popoverId === m.id;

        return (
          <div
            key={m.id}
            data-testid={`milestone-marker-${m.id}`}
            className="absolute top-0 pointer-events-auto"
            style={{ left: x, height: canvasHeight }}
          >
            {/* Vertical line — draggable */}
            <div
              className="absolute top-0 w-px cursor-ew-resize"
              style={{
                backgroundColor: m.color,
                height: canvasHeight,
                opacity: 0.75,
              }}
              onPointerDown={(e) => startDrag(e, m)}
              onPointerMove={(e) => moveDrag(e, m)}
              onPointerUp={(e) => endDrag(e, m)}
              onPointerCancel={() => cancelDrag(m)}
            />

            {/* Top label — draggable; click toggles popover */}
            <button
              type="button"
              title={m.name}
              onPointerDown={(e) => startDrag(e, m)}
              onPointerMove={(e) => moveDrag(e, m)}
              onPointerUp={(e) => endDrag(e, m)}
              onPointerCancel={() => cancelDrag(m)}
              className="absolute flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap max-w-[100px] truncate cursor-ew-resize hover:opacity-90 select-none"
              style={{
                top: headerHeight - 36,
                left: 4,
                backgroundColor: m.color,
                color: "#fff",
                touchAction: "none",
              }}
            >
              {m.icon && <span className="mr-0.5">{m.icon}</span>}
              {m.name}
            </button>

            {/* Drag-date tooltip */}
            {isDragging && drag!.moved && (
              <div
                className="absolute z-50 px-1.5 py-0.5 rounded mono-meta-sm bg-fg/90 text-bg whitespace-nowrap pointer-events-none"
                style={{ top: headerHeight + 4, left: 8 }}
              >
                {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(drag!.previewDate)}
              </div>
            )}

            {/* Popover */}
            {isOpen && !isDragging && (
              <div
                className="absolute z-50 rounded-lg border border-[color:var(--hairline-hi)] bg-[color:var(--popover)] shadow-[0_24px_60px_-24px_rgb(0_0_0/0.6)] p-3 w-64 space-y-1.5 pointer-events-auto"
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
