// Plan #16b-β — 4-stat summary of cards-on-the-roadmap state for a
// workspace. Mirrors the shorthand visual style of the other count-style
// gadgets but lays the four numbers in a 2x2 grid with mono-meta labels.

export function GadgetOnRoadmap({
  data,
}: {
  data: {
    total: number;
    scheduled: number;
    unscheduled: number;
    overdue: number;
  } | null;
}) {
  const v = data ?? { total: 0, scheduled: 0, unscheduled: 0, overdue: 0 };
  const stats: Array<{ label: string; value: number; tone?: string }> = [
    { label: "TOTAL", value: v.total },
    { label: "SCHEDULED", value: v.scheduled },
    { label: "UNSCHEDULED", value: v.unscheduled },
    { label: "OVERDUE", value: v.overdue, tone: v.overdue > 0 ? "text-fg" : undefined },
  ];
  return (
    <div
      className="grid grid-cols-2 gap-3 h-full"
      data-testid="gadget-on-roadmap"
    >
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-hairline px-3 py-2 flex flex-col justify-between"
          data-stat={s.label.toLowerCase()}
        >
          <span className="mono-meta-sm text-fg-faint">{s.label}</span>
          <span
            className={`serif-display text-3xl tabular-nums ${
              s.tone ?? "text-fg"
            }`}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}
