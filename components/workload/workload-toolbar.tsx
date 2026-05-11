"use client";
import { Select } from "@/components/ui/select";

export type RangePreset = "week" | "month" | "quarter";
export type SortKind = "peak" | "alpha";
export type LanesMode = "user" | "workspace";

export function WorkloadToolbar({
  workspaces,
  sprints,
  totalCards,
  wsFilter,
  setWsFilter,
  sprintFilter,
  setSprintFilter,
  rangePreset,
  setRangePreset,
  sortKind,
  setSortKind,
  lanesMode,
  setLanesMode,
}: {
  workspaces: { id: string; name: string }[];
  sprints: { id: string; name: string }[];
  totalCards: number;
  wsFilter: string;
  setWsFilter: (v: string) => void;
  sprintFilter: string;
  setSprintFilter: (v: string) => void;
  rangePreset: RangePreset;
  setRangePreset: (v: RangePreset) => void;
  sortKind: SortKind;
  setSortKind: (v: SortKind) => void;
  lanesMode: LanesMode;
  setLanesMode: (v: LanesMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline pb-3">
      <Field label="WORKSPACE">
        <Select
          value={wsFilter}
          onValueChange={setWsFilter}
          data-testid="workload-workspace-filter"
          options={[
            { value: "", label: `ALL (${totalCards})` },
            ...workspaces.map((w) => ({
              value: w.id,
              label: w.name.toUpperCase(),
            })),
          ]}
          size="sm"
          className="min-w-32"
        />
      </Field>
      <Field label="SPRINT">
        <Select
          value={sprintFilter}
          onValueChange={setSprintFilter}
          data-testid="workload-sprint-filter"
          options={[
            { value: "", label: "ANY" },
            ...sprints.map((s) => ({ value: s.id, label: s.name })),
          ]}
          size="sm"
          className="min-w-32"
        />
      </Field>
      <Field label="RANGE">
        <div
          role="radiogroup"
          aria-label="Range preset"
          className="inline-flex h-8 rounded-md border border-hairline-hi bg-[color:var(--surface)] p-0.5 gap-0.5"
        >
          {(["week", "month", "quarter"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={rangePreset === r}
              onClick={() => setRangePreset(r)}
              data-testid={`workload-range-${r}`}
              className={
                "px-2.5 rounded-[5px] mono-meta-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 " +
                (rangePreset === r
                  ? "bg-[color:var(--surface-hi)] text-fg"
                  : "text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)]")
              }
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>
      <Field label="LANES">
        <Select
          value={lanesMode}
          onValueChange={(v) => setLanesMode(v as LanesMode)}
          data-testid="workload-lanes-mode"
          options={[
            { value: "user", label: "BY USER" },
            { value: "workspace", label: "BY WORKSPACE" },
          ]}
          size="sm"
          className="min-w-36"
        />
      </Field>
      <Field label="SORT">
        <Select
          value={sortKind}
          onValueChange={(v) => setSortKind(v as SortKind)}
          data-testid="workload-sort"
          options={[
            { value: "peak", label: "BY LOAD" },
            { value: "alpha", label: "ALPHABETICAL" },
          ]}
          size="sm"
          className="min-w-36"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="mono-meta-sm text-fg-faint">{label}</span>
      {children}
    </label>
  );
}
