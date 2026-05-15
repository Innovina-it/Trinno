import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { assertUuidOrNotFound } from "@/lib/route-uuid";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards, boards } from "@/lib/db/schema";
import { computeBurndown } from "@/lib/queries/sprints-stats";
import { BurndownChart } from "@/components/sprint/burndown-chart";
import { SprintShiftDatesButton } from "@/components/sprint/sprint-shift-dates-button";

export default async function SprintDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sprintId: string }>;
}) {
  const { workspaceId, sprintId } = await params;
  assertUuidOrNotFound(workspaceId);
  assertUuidOrNotFound(sprintId);
  await requireUser();
  const token = (await getSessionToken())!;

  const [sprint] = await dbAsUser(token, async (tx) =>
    tx.select().from(sprints).where(eq(sprints.id, sprintId)),
  );
  if (!sprint) notFound();

  const sprintCards = await dbAsUser(token, async (tx) =>
    tx
      .select({
        id: cards.id,
        title: cards.title,
        archived: cards.archived,
        storyPoints: cards.storyPoints,
        boardId: cards.boardId,
        boardTitle: boards.title,
        startDate: cards.startDate,
        targetDate: cards.targetDate,
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(eq(cards.sprintId, sprintId)),
  );

  // Date range summary across all cards (so users see the shift land
  // after pressing Apply on SprintShiftDatesButton).
  const cardDates = sprintCards
    .flatMap((c) => [c.startDate, c.targetDate])
    .filter((d): d is Date => d != null);
  const minDate = cardDates.length
    ? new Date(Math.min(...cardDates.map((d) => d.getTime())))
    : null;
  const maxDate = cardDates.length
    ? new Date(Math.max(...cardDates.map((d) => d.getTime())))
    : null;
  const fmt = (d: Date | null) =>
    d == null
      ? "—"
      : d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
  const burndown = await computeBurndown(token, sprintId);

  const remaining = sprintCards.filter((c) => !c.archived);
  const completed = sprintCards.filter((c) => c.archived);

  return (
    <div className="mx-auto max-w-5xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-8">
      <header className="space-y-2 border-b border-hairline pb-4">
        <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
          <Link
            href={`/w/${workspaceId}/backlog`}
            className="hover:text-fg"
          >
            SPRINTS
          </Link>
          <span>/</span>
          <span className="text-fg">{sprint.state.toUpperCase()}</span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <h1 className="font-sans text-2xl font-bold tracking-tight text-fg truncate">
            {sprint.name}
          </h1>
          <span className="chip mono-meta-sm">{sprint.state.toUpperCase()}</span>
        </div>
        {sprint.goal && (
          <p className="text-sm text-fg-muted">{sprint.goal}</p>
        )}
        <div className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
          <SprintShiftDatesButton cardIds={sprintCards.map((c) => c.id)} />
          <span
            className="mono-meta-sm text-fg-faint"
            data-testid="sprint-card-date-range"
          >
            CARD DATES: {fmt(minDate)} → {fmt(maxDate)}
          </span>
        </div>
      </header>

      <BurndownChart total={burndown.total} points={burndown.points} />

      <section className="grid gap-6 md:grid-cols-2">
        <div className="glass rounded-2xl">
          <header className="px-4 py-2 border-b border-hairline mono-meta">
            REMAINING ({remaining.length})
          </header>
          <ul className="divide-y divide-hairline">
            {remaining.map((c) => (
              <li
                key={c.id}
                className="px-4 py-2 flex items-center gap-2 text-sm"
              >
                <Link
                  href={`/b/${c.boardId}/c/${c.id}`}
                  className="flex-1 truncate hover:underline"
                >
                  {c.title}
                </Link>
                {(c.startDate || c.targetDate) && (
                  <span className="mono-meta-sm text-fg-faint tabular-nums shrink-0">
                    {fmt(c.startDate)} → {fmt(c.targetDate)}
                  </span>
                )}
                {c.storyPoints != null && (
                  <span className="chip tabular-nums">{c.storyPoints}</span>
                )}
              </li>
            ))}
            {remaining.length === 0 && (
              <li className="px-4 py-4 text-fg-faint text-sm">
                All done.
              </li>
            )}
          </ul>
        </div>
        <div className="glass rounded-2xl">
          <header className="px-4 py-2 border-b border-hairline mono-meta">
            COMPLETED ({completed.length})
          </header>
          <ul className="divide-y divide-hairline">
            {completed.map((c) => (
              <li
                key={c.id}
                className="px-4 py-2 flex items-center gap-2 text-sm"
              >
                <Link
                  href={`/b/${c.boardId}/c/${c.id}`}
                  className="flex-1 truncate hover:underline line-through text-fg-muted"
                >
                  {c.title}
                </Link>
                {(c.startDate || c.targetDate) && (
                  <span className="mono-meta-sm text-fg-faint tabular-nums shrink-0">
                    {fmt(c.startDate)} → {fmt(c.targetDate)}
                  </span>
                )}
                {c.storyPoints != null && (
                  <span className="chip tabular-nums">{c.storyPoints}</span>
                )}
              </li>
            ))}
            {completed.length === 0 && (
              <li className="px-4 py-4 text-fg-faint text-sm">
                Nothing completed yet.
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
