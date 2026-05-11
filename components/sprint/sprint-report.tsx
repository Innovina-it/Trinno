import Link from "next/link";
import { BurndownChart } from "@/components/sprint/burndown-chart";
import { VelocityStrip } from "@/components/sprint/velocity-strip";
import { CopyPermalinkButton } from "@/components/sprint/copy-permalink-button";
import type { BurndownPoint } from "@/lib/queries/sprints-stats";

export type SprintReportCard = {
  id: string;
  title: string;
  boardId: string;
  boardTitle: string;
  storyPoints: number | null;
  completedAt: string | null;
  ownerName: string | null;
  addedMidSprint: boolean;
  completedInSprint: boolean;
};

export type SprintReportProps = {
  workspaceId: string;
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    startDate: string | null;
    endDate: string | null;
    completedAt: string | null;
  };
  stats: {
    committedPoints: number;
    completedPoints: number;
    totalPoints: number;
    completionRate: number;
    cardsCompleted: number;
    cardsAddedMidSprint: number;
    cardsCarriedOver: number;
  };
  burndown: {
    total: number;
    points: BurndownPoint[];
  };
  velocity: Array<{
    sprintId: string;
    name: string;
    pointsCompleted: number;
  }>;
  cards: SprintReportCard[];
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function SprintReport({
  workspaceId,
  sprint,
  stats,
  burndown,
  velocity,
  cards,
}: SprintReportProps) {
  const completedCards = cards.filter((c) => c.completedInSprint);
  const carriedOver = cards.filter((c) => !c.completedInSprint);

  return (
    <div
      className="mx-auto max-w-5xl px-6 py-10 space-y-8"
      data-testid="sprint-report"
    >
      <header className="space-y-3 border-b border-hairline pb-4">
        <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
          <Link
            href={`/w/${workspaceId}/backlog`}
            className="hover:text-fg"
          >
            SPRINTS
          </Link>
          <span>/</span>
          <Link
            href={`/w/${workspaceId}/sprints/${sprint.id}`}
            className="hover:text-fg truncate"
          >
            {sprint.name.toUpperCase()}
          </Link>
          <span>/</span>
          <span className="text-fg">REPORT</span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h1 className="font-sans text-2xl font-bold tracking-tight text-fg truncate">
              {sprint.name}
            </h1>
            <p className="mono-meta-sm text-fg-faint tabular-nums">
              {formatDate(sprint.startDate)} {" → "} {formatDate(sprint.endDate)}
              {sprint.completedAt && (
                <>
                  {"  ·  CLOSED "}
                  {formatDateTime(sprint.completedAt)}
                </>
              )}
            </p>
            {sprint.goal && (
              <p className="text-sm text-fg-muted">{sprint.goal}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="chip mono-meta-sm">COMPLETED</span>
            <CopyPermalinkButton />
          </div>
        </div>
      </header>

      {/* Stats grid */}
      <section
        className="grid gap-3 grid-cols-2 md:grid-cols-4"
        data-testid="sprint-report-stats"
      >
        <Stat label="COMMITTED" value={`${stats.committedPoints} PT`} />
        <Stat label="COMPLETED" value={`${stats.completedPoints} PT`} />
        <Stat label="COMPLETION" value={`${stats.completionRate}%`} />
        <Stat label="TOTAL IN SPRINT" value={`${stats.totalPoints} PT`} />
        <Stat
          label="CARDS DONE"
          value={String(stats.cardsCompleted)}
        />
        <Stat
          label="ADDED MID-SPRINT"
          value={String(stats.cardsAddedMidSprint)}
        />
        <Stat
          label="CARRIED OVER"
          value={String(stats.cardsCarriedOver)}
        />
        <Stat
          label="CARDS TOTAL"
          value={String(cards.length)}
        />
      </section>

      <BurndownChart total={burndown.total} points={burndown.points} />

      {velocity.length > 0 && (
        <section className="space-y-2">
          <h3 className="mono-meta text-fg-faint">VELOCITY CONTEXT</h3>
          <VelocityStrip data={velocity} />
        </section>
      )}

      {/* Cards table */}
      <section
        className="grid gap-6 md:grid-cols-2"
        data-testid="sprint-report-cards"
      >
        <CardsTable
          title="COMPLETED"
          cards={completedCards}
          emptyText="No cards completed."
        />
        <CardsTable
          title="CARRIED OVER"
          cards={carriedOver}
          emptyText="Nothing carried over."
        />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-4 space-y-1">
      <div className="mono-meta-sm text-fg-faint">{label}</div>
      <div className="font-sans text-2xl font-semibold tabular-nums text-fg">
        {value}
      </div>
    </div>
  );
}

function CardsTable({
  title,
  cards,
  emptyText,
}: {
  title: string;
  cards: SprintReportCard[];
  emptyText: string;
}) {
  return (
    <div className="glass rounded-2xl">
      <header className="px-4 py-2 border-b border-hairline mono-meta flex items-center justify-between">
        <span>
          {title} ({cards.length})
        </span>
      </header>
      {cards.length === 0 ? (
        <div className="px-4 py-4 text-fg-faint text-sm italic">
          {emptyText}
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {cards.map((c) => (
            <li
              key={c.id}
              className="px-4 py-2 flex items-center gap-3 text-sm"
            >
              <Link
                href={`/b/${c.boardId}/c/${c.id}`}
                className="flex-1 min-w-0 truncate hover:underline"
              >
                {c.title}
              </Link>
              {c.addedMidSprint && (
                <span className="chip mono-meta-sm" title="Added mid-sprint">
                  +MID
                </span>
              )}
              <span
                className="mono-meta-sm text-fg-faint hidden sm:inline tabular-nums"
                title={c.completedAt ?? ""}
              >
                {c.completedAt ? formatDate(c.completedAt) : "—"}
              </span>
              <span className="mono-meta-sm text-fg-faint hidden md:inline truncate max-w-[10rem]">
                {c.ownerName ?? "—"}
              </span>
              {c.storyPoints != null && (
                <span className="chip tabular-nums">{c.storyPoints}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
