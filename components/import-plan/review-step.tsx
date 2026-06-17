"use client";

import { useState } from "react";
import { ChevronRight, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { isoToDate, dateToIso } from "@/lib/plan-import/date-adapter";
import { DurationControl } from "./duration-control";
import type { ProjectPlan, WorkPackage } from "@/lib/plan-import/types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "S"}`;

// DatePicker speaks Date; the plan stores YYYY-MM-DD strings. Bridge at the edge.
function IsoDateField({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (iso: string) => void;
}) {
  return (
    <DatePicker
      value={isoToDate(value)}
      onChange={(d) => onChange(dateToIso(d))}
      inputLabel={label}
      triggerLabel={label}
    />
  );
}

// All edits clone-and-replace the ProjectPlan and call onChange. Fully controlled.
export function ReviewStep({
  plan,
  onChange,
  onBack,
  onConfirm,
}: {
  plan: ProjectPlan;
  onChange: (p: ProjectPlan) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set()); // collapsed by default

  function patch(p: Partial<ProjectPlan>) {
    onChange({ ...plan, ...p });
  }
  function patchWp(wi: number, p: Partial<WorkPackage>) {
    patch({ workPackages: plan.workPackages.map((wp, i) => (i === wi ? { ...wp, ...p } : wp)) });
  }
  function toggle(wi: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(wi)) next.delete(wi);
      else next.add(wi);
      return next;
    });
  }

  const totalTasks = plan.workPackages.reduce((n, wp) => n + wp.tasks.length, 0);
  const totalDels = plan.workPackages.reduce((n, wp) => n + wp.deliverables.length, 0);

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[14rem] flex-1 space-y-2">
            <Label>Workspace name</Label>
            <Input
              aria-label="Workspace name"
              value={plan.workspaceName}
              onChange={(e) => patch({ workspaceName: e.target.value })}
            />
          </div>
          <DurationControl plan={plan} onChange={onChange} />
        </div>
        <div className="space-y-2">
          <Label>Parent board title</Label>
          <Input
            aria-label="Parent board title"
            value={plan.parentBoardTitle}
            onChange={(e) => patch({ parentBoardTitle: e.target.value })}
          />
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="mono-meta text-fg-muted">Work packages ({plan.workPackages.length})</h2>
        <div className="space-y-2">
          {plan.workPackages.map((wp, wi) => {
            const isOpen = open.has(wi);
            return (
              <div
                key={wi}
                className="rounded-xl border border-[color:var(--hairline)] bg-[color:var(--surface)]"
              >
                <div className="flex items-center gap-2 p-3">
                  <button
                    type="button"
                    onClick={() => toggle(wi)}
                    aria-expanded={isOpen}
                    className="flex flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-fg/40 rounded-md"
                  >
                    <ChevronRight
                      className={cn(
                        "size-4 shrink-0 text-fg-muted transition-transform duration-200",
                        isOpen && "rotate-90",
                      )}
                    />
                    <span className="mono-meta text-fg-faint">{wp.code}</span>
                    <span className="truncate text-sm font-semibold text-fg">{wp.title}</span>
                    <span className="ml-auto mono-meta text-fg-faint">
                      {plural(wp.tasks.length, "TASK")} · {plural(wp.deliverables.length, "DELIVERABLE")}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${wp.code}`}
                    onClick={() =>
                      patch({ workPackages: plan.workPackages.filter((_, i) => i !== wi) })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                {isOpen && (
                  <div className="space-y-4 border-t border-[color:var(--hairline)] p-3">
                    <Input
                      aria-label={`${wp.code} title`}
                      value={wp.title}
                      onChange={(e) => patchWp(wi, { title: e.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`${wp.code} option`}
                        className="h-10 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--surface)] px-2.5 text-sm text-fg outline-none focus-visible:border-[color:var(--accent-cyan)]"
                        value={wp.option}
                        onChange={(e) =>
                          patchWp(wi, { option: e.target.value as WorkPackage["option"] })
                        }
                      >
                        <option value="RI">RI</option>
                        <option value="SS">SS</option>
                        <option value="RI+SS">RI+SS</option>
                      </select>
                      <IsoDateField
                        value={wp.start}
                        label={`${wp.code} start`}
                        onChange={(iso) => patchWp(wi, { start: iso })}
                      />
                      <IsoDateField
                        value={wp.end}
                        label={`${wp.code} end`}
                        onChange={(iso) => patchWp(wi, { end: iso })}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <p className="mono-meta text-fg-faint">Tasks</p>
                      {wp.tasks.map((t, ti) => (
                        <div
                          key={ti}
                          className="flex items-center gap-2 border-b border-[color:var(--hairline)] pb-1.5 last:border-0"
                        >
                          <Input
                            aria-label={`${wp.code} task ${ti}`}
                            value={t.title}
                            onChange={(e) => {
                              const tasks = wp.tasks.map((x, i) =>
                                i === ti ? { ...x, title: e.target.value } : x,
                              );
                              patchWp(wi, { tasks });
                            }}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove task ${ti} of ${wp.code}`}
                            onClick={() => patchWp(wi, { tasks: wp.tasks.filter((_, i) => i !== ti) })}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => patchWp(wi, { tasks: [...wp.tasks, { title: "New task", description: "" }] })}
                      >
                        <Plus className="size-3.5" /> Task
                      </Button>
                    </div>

                    <div className="space-y-1.5">
                      <p className="mono-meta text-fg-faint">Deliverables</p>
                      {wp.deliverables.map((d, di) => (
                        <div
                          key={di}
                          className="flex items-center gap-2 border-b border-[color:var(--hairline)] pb-1.5 last:border-0"
                        >
                          <Input
                            aria-label={`${wp.code} deliverable ${di} title`}
                            value={d.title}
                            onChange={(e) => {
                              const deliverables = wp.deliverables.map((x, i) =>
                                i === di ? { ...x, title: e.target.value } : x,
                              );
                              patchWp(wi, { deliverables });
                            }}
                          />
                          <div className="w-44 shrink-0">
                            <IsoDateField
                              value={d.due}
                              label={`${wp.code} deliverable ${di} due`}
                              onChange={(iso) => {
                                const deliverables = wp.deliverables.map((x, i) =>
                                  i === di ? { ...x, due: iso } : x,
                                );
                                patchWp(wi, { deliverables });
                              }}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove deliverable ${di} of ${wp.code}`}
                            onClick={() =>
                              patchWp(wi, {
                                deliverables: wp.deliverables.filter((_, i) => i !== di),
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() =>
                          patchWp(wi, {
                            deliverables: [
                              ...wp.deliverables,
                              { title: "New deliverable", taskIndex: 0, due: wp.end, month: 0, description: "" },
                            ],
                          })
                        }
                      >
                        <Plus className="size-3.5" /> Deliverable
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="mono-meta text-fg-muted">Milestones ({plan.milestones.length})</h2>
        {plan.milestones.map((m, mi) => (
          <div key={mi} className="flex items-center gap-2">
            <Input
              aria-label={`Milestone ${mi} name`}
              value={m.name}
              onChange={(e) => {
                const milestones = plan.milestones.map((x, i) =>
                  i === mi ? { ...x, name: e.target.value } : x,
                );
                patch({ milestones });
              }}
            />
            <div className="w-44 shrink-0">
              <IsoDateField
                value={m.date}
                label={`Milestone ${mi} date`}
                onChange={(iso) => {
                  const milestones = plan.milestones.map((x, i) =>
                    i === mi ? { ...x, date: iso } : x,
                  );
                  patch({ milestones });
                }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove milestone ${mi}`}
              onClick={() => patch({ milestones: plan.milestones.filter((_, i) => i !== mi) })}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            patch({
              milestones: [
                ...plan.milestones,
                { name: "New milestone", date: plan.workPackages[0]?.end ?? "2026-01-01", description: "" },
              ],
            })
          }
        >
          <Plus className="size-3.5" /> Add milestone
        </Button>
      </section>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-4 border-t border-[color:var(--hairline)] bg-[color:var(--bg-1)] px-6 py-3">
        <span className="mono-meta text-fg-faint">
          {plan.workPackages.length} WP · {plural(totalTasks, "TASK")} · {plural(totalDels, "DELIVERABLE")} · {plural(plan.milestones.length, "MILESTONE")}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="button" onClick={onConfirm}>
            Build workspace
          </Button>
        </div>
      </div>
    </div>
  );
}
