import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import { sprints, cards, boards } from "@/lib/db/schema";
import { computeBurndown } from "@/lib/queries/sprints-stats";
import { BurndownChart } from "@/components/sprint/burndown-chart";

export default async function SprintDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; sprintId: string }>;
}) {
  const { workspaceId, sprintId } = await params;
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
      })
      .from(cards)
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(eq(cards.sprintId, sprintId)),
  );
  const burndown = await computeBurndown(token, sprintId);

  const remaining = sprintCards.filter((c) => !c.archived);
  const completed = sprintCards.filter((c) => c.archived);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
      <header className="space-y-2">
        <Link
          href={`/w/${workspaceId}/backlog`}
          className="mono-meta-sm text-fg-muted hover:text-fg"
        >
          ← Back to backlog
        </Link>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="serif-display text-4xl">{sprint.name}</h1>
          <span className="chip">{sprint.state.toUpperCase()}</span>
        </div>
        {sprint.goal && (
          <p className="text-fg-muted italic">&ldquo;{sprint.goal}&rdquo;</p>
        )}
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
                {c.storyPoints != null && (
                  <span className="chip tabular-nums">{c.storyPoints}</span>
                )}
              </li>
            ))}
            {remaining.length === 0 && (
              <li className="px-4 py-4 text-fg-faint italic text-sm">
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
                {c.storyPoints != null && (
                  <span className="chip tabular-nums">{c.storyPoints}</span>
                )}
              </li>
            ))}
            {completed.length === 0 && (
              <li className="px-4 py-4 text-fg-faint italic text-sm">
                Nothing completed yet.
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
