"use client";

import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectPlan, WorkPackage } from "@/lib/plan-import/types";

// All edits clone-and-replace the ProjectPlan and call onChange — the wizard
// holds the plan in state, this component is fully controlled.
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
  function patch(p: Partial<ProjectPlan>) {
    onChange({ ...plan, ...p });
  }
  function patchWp(wi: number, p: Partial<WorkPackage>) {
    const wps = plan.workPackages.map((wp, i) => (i === wi ? { ...wp, ...p } : wp));
    patch({ workPackages: wps });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Workspace name</Label>
        <Input
          aria-label="Workspace name"
          value={plan.workspaceName}
          onChange={(e) => patch({ workspaceName: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Parent board title</Label>
        <Input
          aria-label="Parent board title"
          value={plan.parentBoardTitle}
          onChange={(e) => patch({ parentBoardTitle: e.target.value })}
        />
      </div>

      <div className="space-y-3">
        <h2 className="mono-meta text-fg-muted">Work packages ({plan.workPackages.length})</h2>
        {plan.workPackages.map((wp, wi) => (
          <details key={wi} className="rounded-xl border border-[color:var(--hairline)] p-3" open>
            <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
              <span>{wp.code} — {wp.title}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${wp.code}`}
                onClick={(e) => {
                  e.preventDefault();
                  patch({ workPackages: plan.workPackages.filter((_, i) => i !== wi) });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </summary>

            <div className="mt-3 space-y-3">
              <Input
                aria-label={`${wp.code} title`}
                value={wp.title}
                onChange={(e) => patchWp(wi, { title: e.target.value })}
              />
              <div className="flex gap-2">
                <select
                  aria-label={`${wp.code} option`}
                  className="h-10 rounded-xl border border-[color:var(--hairline)] bg-[color:var(--surface)] px-2 text-sm"
                  value={wp.option}
                  onChange={(e) => patchWp(wi, { option: e.target.value as WorkPackage["option"] })}
                >
                  <option value="RI">RI</option>
                  <option value="SS">SS</option>
                  <option value="RI+SS">RI+SS</option>
                </select>
                <Input
                  aria-label={`${wp.code} start`}
                  value={wp.start}
                  onChange={(e) => patchWp(wi, { start: e.target.value })}
                />
                <Input
                  aria-label={`${wp.code} end`}
                  value={wp.end}
                  onChange={(e) => patchWp(wi, { end: e.target.value })}
                />
              </div>

              {/* Tasks */}
              <div className="space-y-1">
                <p className="text-xs text-fg-muted">Tasks</p>
                {wp.tasks.map((t, ti) => (
                  <div key={ti} className="flex gap-2">
                    <Input
                      aria-label={`${wp.code} task ${ti}`}
                      value={t.title}
                      onChange={(e) => {
                        const tasks = wp.tasks.map((x, i) => (i === ti ? { ...x, title: e.target.value } : x));
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
              </div>

              {/* Deliverables */}
              <div className="space-y-1">
                <p className="text-xs text-fg-muted">Deliverables</p>
                {wp.deliverables.map((d, di) => (
                  <div key={di} className="flex gap-2">
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
                    <Input
                      aria-label={`${wp.code} deliverable ${di} due`}
                      value={d.due}
                      onChange={(e) => {
                        const deliverables = wp.deliverables.map((x, i) =>
                          i === di ? { ...x, due: e.target.value } : x,
                        );
                        patchWp(wi, { deliverables });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove deliverable ${di} of ${wp.code}`}
                      onClick={() =>
                        patchWp(wi, { deliverables: wp.deliverables.filter((_, i) => i !== di) })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ))}
      </div>

      {/* Milestones */}
      <div className="space-y-2">
        <h2 className="mono-meta text-fg-muted">Milestones ({plan.milestones.length})</h2>
        {plan.milestones.map((m, mi) => (
          <div key={mi} className="flex gap-2">
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
            <Input
              aria-label={`Milestone ${mi} date`}
              value={m.date}
              onChange={(e) => {
                const milestones = plan.milestones.map((x, i) =>
                  i === mi ? { ...x, date: e.target.value } : x,
                );
                patch({ milestones });
              }}
            />
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
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() =>
            patch({ milestones: [...plan.milestones, { name: "New milestone", date: plan.workPackages[0]?.end ?? "2026-01-01", description: "" }] })
          }
        >
          <Plus className="size-3.5" /> Add milestone
        </Button>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onConfirm}>
          Looks right — build workspace
        </Button>
      </div>
    </div>
  );
}
