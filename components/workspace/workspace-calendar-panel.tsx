"use client";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  upsertWorkspaceHoliday,
  muteWorkspaceHoliday,
  unmuteWorkspaceHoliday,
  deleteWorkspaceHoliday,
} from "@/actions/workspace-holidays";
import type { WorkspaceHolidayRow } from "@/lib/queries/workspace-holidays";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function weekdayAbbr(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return WD[d.getUTCDay()];
}

export function WorkspaceCalendarPanel({
  workspaceId,
  rows: initialRows,
}: {
  workspaceId: string;
  rows: WorkspaceHolidayRow[];
}) {
  const [rows, setRows] = useState<WorkspaceHolidayRow[]>(initialRows);
  const [pending, start] = useTransition();
  const [editingIso, setEditingIso] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Add form state
  const [newIso, setNewIso] = useState("");
  const [newName, setNewName] = useState("");

  // Year filter — required because the full preset list spans 7+ years
  // and the table grows long. Defaults to the current year.
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.isoDate.slice(0, 4));
    return Array.from(set).sort();
  }, [rows]);
  const currentYear = String(new Date().getUTCFullYear());
  const [selectedYear, setSelectedYear] = useState<string>(() =>
    years.includes(currentYear) ? currentYear : (years[0] ?? currentYear),
  );

  // Group by year for visual breaks. Pure derive; cheap.
  const grouped = useMemo(() => {
    const m = new Map<string, WorkspaceHolidayRow[]>();
    for (const r of rows) {
      const yr = r.isoDate.slice(0, 4);
      if (yr !== selectedYear) continue;
      const bucket = m.get(yr) ?? [];
      bucket.push(r);
      m.set(yr, bucket);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, selectedYear]);

  function refresh(newRows: WorkspaceHolidayRow[]) {
    setRows(newRows);
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const iso = newIso.trim();
    const name = newName.trim();
    if (!ISO_RE.test(iso)) {
      toast.error("Date must be YYYY-MM-DD");
      return;
    }
    if (!name) {
      toast.error("Name required");
      return;
    }
    if (rows.some((r) => r.isoDate === iso && r.source === "custom")) {
      toast.error("Custom day already exists for this date");
      return;
    }
    start(async () => {
      try {
        await upsertWorkspaceHoliday({ workspaceId, isoDate: iso, name });
        // Optimistic merge: if iso matches a preset, treat as rename;
        // otherwise treat as custom add. Sort kept consistent.
        const isPreset = rows.some(
          (r) => r.isoDate === iso && r.source === "preset",
        );
        const next: WorkspaceHolidayRow[] = isPreset
          ? rows.map((r) =>
              r.isoDate === iso && r.source === "preset"
                ? { ...r, name, renamed: true, muted: false }
                : r,
            )
          : [
              ...rows,
              {
                isoDate: iso,
                name,
                source: "custom" as const,
                muted: false,
                renamed: false,
              },
            ].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
        refresh(next);
        // Snap the year filter to the added row so the user sees it.
        setSelectedYear(iso.slice(0, 4));
        setNewIso("");
        setNewName("");
        toast.success(isPreset ? "Preset renamed" : "Holiday added");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function toggleMute(row: WorkspaceHolidayRow) {
    if (row.source !== "preset") return;
    start(async () => {
      try {
        if (row.muted) {
          await unmuteWorkspaceHoliday({
            workspaceId,
            isoDate: row.isoDate,
          });
          refresh(
            rows.map((r) =>
              r.isoDate === row.isoDate ? { ...r, muted: false } : r,
            ),
          );
          toast.success("Restored");
        } else {
          await muteWorkspaceHoliday({
            workspaceId,
            isoDate: row.isoDate,
          });
          refresh(
            rows.map((r) =>
              r.isoDate === row.isoDate ? { ...r, muted: true } : r,
            ),
          );
          toast.success("Muted");
        }
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function startEdit(row: WorkspaceHolidayRow) {
    setEditingIso(row.isoDate);
    setEditingName(row.name);
  }
  function cancelEdit() {
    setEditingIso(null);
    setEditingName("");
  }
  function saveEdit() {
    const name = editingName.trim();
    if (!editingIso) return;
    if (!name) {
      toast.error("Name required");
      return;
    }
    start(async () => {
      try {
        await upsertWorkspaceHoliday({
          workspaceId,
          isoDate: editingIso,
          name,
        });
        refresh(
          rows.map((r) =>
            r.isoDate === editingIso
              ? { ...r, name, renamed: r.source === "preset" }
              : r,
          ),
        );
        cancelEdit();
        toast.success("Saved");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function remove(row: WorkspaceHolidayRow) {
    if (row.source !== "custom") return;
    start(async () => {
      try {
        await deleteWorkspaceHoliday({
          workspaceId,
          isoDate: row.isoDate,
        });
        refresh(rows.filter((r) => r.isoDate !== row.isoDate));
        toast.success("Removed");
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-5">
      <p className="text-fg-muted text-sm leading-relaxed max-w-prose">
        Italian bank holidays preset for this workspace. Add company-specific
        days, rename a preset, or mute a day on which the office works.
        Changes apply to every roadmap in this workspace.
      </p>

      {/* Year filter — mandatory. The preset spans 7+ years; without
          this the table runs ~85 rows. Renders as a mono tab strip,
          active state via a 1px ring + bg lift per the design doctrine. */}
      <div
        role="tablist"
        aria-label="Filter by year"
        className="flex flex-wrap gap-1"
      >
        {years.map((y) => {
          const active = y === selectedYear;
          return (
            <button
              key={y}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedYear(y)}
              className={`h-7 px-2.5 rounded-md mono-meta-sm tracking-[0.08em] tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
                active
                  ? "bg-[color:var(--surface-strong)] text-fg ring-1 ring-fg/40 ring-inset"
                  : "text-fg-muted hover:text-fg hover:bg-[color:var(--surface)]"
              }`}
            >
              {y}
            </button>
          );
        })}
      </div>

      {/* Add form. Native date input keeps deps thin; doctrine input
          styling applies via the shadcn Input. */}
      <form
        onSubmit={add}
        className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start"
      >
        <div className="flex flex-col gap-1 shrink-0">
          <label className="mono-meta-sm text-fg-faint" htmlFor="new-iso">
            DATE
          </label>
          <Input
            id="new-iso"
            type="date"
            value={newIso}
            onChange={(e) => setNewIso(e.target.value)}
            className="sm:w-44 [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:invert"
            required
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="mono-meta-sm text-fg-faint" htmlFor="new-name">
            NAME
          </label>
          <Input
            id="new-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Chiusura aziendale"
            maxLength={120}
            required
          />
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {/* Spacer label so the button bottom-aligns with the inputs. */}
          <span className="mono-meta-sm text-transparent select-none">.</span>
          <Button
            type="submit"
            variant="default"
            disabled={pending}
            className="gap-1.5"
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </form>

      {/* Calendar table — grouped by year, hairline-divided rows. */}
      <div className="space-y-4">
        {grouped.map(([year, yearRows]) => (
          <div key={year} className="space-y-1.5">
            <div className="mono-meta-sm text-fg-faint pl-2">{year}</div>
            <ul className="rounded-xl border border-hairline divide-y divide-hairline overflow-hidden">
              {yearRows.map((row) => {
                const isEditing = editingIso === row.isoDate;
                return (
                  <li
                    key={row.isoDate}
                    className={`grid grid-cols-[minmax(96px,auto)_1fr_auto_auto] gap-3 items-center px-3 py-2 ${
                      row.muted ? "opacity-50" : ""
                    }`}
                  >
                    <span className="mono-meta text-fg-muted whitespace-nowrap">
                      {row.isoDate}
                      <span className="ml-1.5 text-fg-faint tracking-[0.1em]">
                        {weekdayAbbr(row.isoDate)}
                      </span>
                    </span>
                    {isEditing ? (
                      <Input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveEdit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className="h-8"
                      />
                    ) : (
                      <span
                        className={`text-fg text-sm truncate ${
                          row.muted ? "line-through" : ""
                        }`}
                      >
                        {row.name}
                      </span>
                    )}
                    <span
                      className="mono-meta-sm text-fg-faint tracking-[0.08em]"
                      title={row.source === "preset" ? "Built-in preset" : "Custom day"}
                    >
                      {row.source === "preset"
                        ? row.renamed
                          ? "RENAMED"
                          : "PRESET"
                        : "CUSTOM"}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {isEditing ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={pending}
                            onClick={saveEdit}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={cancelEdit}
                            aria-label="Cancel"
                          >
                            <X className="size-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={pending || row.muted}
                            onClick={() => startEdit(row)}
                            aria-label="Edit name"
                            title="Edit name"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {row.source === "preset" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              disabled={pending}
                              onClick={() => toggleMute(row)}
                            >
                              {row.muted ? "Unmute" : "Mute"}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              onClick={() => remove(row)}
                              aria-label="Delete"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
