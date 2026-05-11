"use client";

interface MeTodayStripProps {
  overdue: number;
  dueToday: number;
  completedToday: number;
}

interface TileProps {
  label: string;
  count: number;
  kind: "overdue" | "due-today" | "completed-today";
  accentCount?: boolean;
}

function Tile({ label, count, kind, accentCount }: TileProps) {
  return (
    <div
      data-testid="me-today-tile"
      data-kind={kind}
      className="flex flex-1 flex-col gap-1 rounded-2xl border border-white/10 bg-white/5 px-6 py-5 backdrop-blur"
    >
      <span className="mono-meta-sm uppercase tracking-widest text-fg-faint">
        {label}
      </span>
      <span
        className={`font-serif text-4xl font-bold tabular-nums leading-none${accentCount ? " text-[color:var(--accent-magenta)]" : ""}`}
      >
        {count}
      </span>
      <span className="mono-meta-sm text-fg-faint">
        {count === 1 ? "card" : "cards"}
      </span>
    </div>
  );
}

export function MeTodayStrip({
  overdue,
  dueToday,
  completedToday,
}: MeTodayStripProps) {
  return (
    <div
      data-testid="me-today-strip"
      className="flex flex-row gap-4"
    >
      <Tile
        label="Overdue"
        count={overdue}
        kind="overdue"
        accentCount={overdue > 0}
      />
      <Tile
        label="Due Today"
        count={dueToday}
        kind="due-today"
      />
      <Tile
        label="Completed Today"
        count={completedToday}
        kind="completed-today"
      />
    </div>
  );
}
