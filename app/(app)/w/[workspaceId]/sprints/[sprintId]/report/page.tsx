import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { dbAsUser } from "@/lib/db/client";
import {
  sprints,
  cards,
  boards,
  profiles,
  cardSprintHistory,
} from "@/lib/db/schema";
import { computeBurndown, computeVelocity } from "@/lib/queries/sprints-stats";
import {
  aggregateSprintReport,
  completionRate,
} from "@/lib/queries/sprint-report";
import {
  SprintReport,
  type SprintReportCard,
} from "@/components/sprint/sprint-report";

export default async function SprintReportPage({
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
  if (sprint.state !== "completed") notFound();
  if (sprint.workspaceId !== workspaceId) notFound();

  const [sprintCardRows, historyRows, burndown, velocity] = await Promise.all([
    dbAsUser(token, async (tx) =>
      tx
        .select({
          id: cards.id,
          title: cards.title,
          archived: cards.archived,
          storyPoints: cards.storyPoints,
          completedAt: cards.completedAt,
          boardId: cards.boardId,
          boardTitle: boards.title,
          ownerId: cards.ownerId,
          ownerName: profiles.displayName,
        })
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .leftJoin(profiles, eq(profiles.id, cards.ownerId))
        .where(eq(cards.sprintId, sprintId)),
    ),
    dbAsUser(token, async (tx) =>
      tx
        .select({
          cardId: cardSprintHistory.cardId,
          assignedAt: cardSprintHistory.assignedAt,
        })
        .from(cardSprintHistory)
        .where(eq(cardSprintHistory.sprintId, sprintId)),
    ),
    computeBurndown(token, sprintId),
    computeVelocity(token, workspaceId, 6),
  ]);

  const aggregates = aggregateSprintReport(
    sprintCardRows.map((c) => ({
      id: c.id,
      storyPoints: c.storyPoints,
      completedAt: c.completedAt
        ? c.completedAt instanceof Date
          ? c.completedAt
          : new Date(c.completedAt)
        : null,
    })),
    historyRows.map((h) => ({
      cardId: h.cardId,
      assignedAt:
        h.assignedAt instanceof Date ? h.assignedAt : new Date(h.assignedAt),
    })),
    {
      startDate: sprint.startDate ? new Date(sprint.startDate) : null,
      endDate: sprint.endDate ? new Date(sprint.endDate) : null,
      completedAt: sprint.completedAt ? new Date(sprint.completedAt) : null,
    },
  );

  const reportCards: SprintReportCard[] = sprintCardRows.map((c) => {
    const flags = aggregates.byCard.get(c.id) ?? {
      addedMidSprint: false,
      completedInSprint: false,
    };
    const completedAt = c.completedAt
      ? c.completedAt instanceof Date
        ? c.completedAt
        : new Date(c.completedAt)
      : null;
    return {
      id: c.id,
      title: c.title,
      boardId: c.boardId,
      boardTitle: c.boardTitle,
      storyPoints: c.storyPoints,
      completedAt: completedAt ? completedAt.toISOString() : null,
      ownerName: c.ownerName ?? null,
      addedMidSprint: flags.addedMidSprint,
      completedInSprint: flags.completedInSprint,
    };
  });

  // Completed = points completed inside the sprint window. We use the
  // last burndown point's `pointsCompleted` for parity with the chart;
  // computeBurndown reads the same `cards.completed_at` source.
  const completedPoints =
    burndown.points.length > 0
      ? burndown.points[burndown.points.length - 1].pointsCompleted
      : 0;
  const totalPoints = burndown.total;
  const rate = completionRate(
    completedPoints,
    aggregates.committedPoints,
    totalPoints,
  );

  return (
    <SprintReport
      workspaceId={workspaceId}
      sprint={{
        id: sprint.id,
        name: sprint.name,
        goal: sprint.goal,
        startDate: sprint.startDate
          ? new Date(sprint.startDate).toISOString()
          : null,
        endDate: sprint.endDate
          ? new Date(sprint.endDate).toISOString()
          : null,
        completedAt: sprint.completedAt
          ? new Date(sprint.completedAt).toISOString()
          : null,
      }}
      stats={{
        committedPoints: aggregates.committedPoints,
        completedPoints,
        totalPoints,
        completionRate: rate,
        cardsCompleted: aggregates.cardsCompleted,
        cardsAddedMidSprint: aggregates.cardsAddedMidSprint,
        cardsCarriedOver: aggregates.cardsCarriedOver,
      }}
      burndown={{
        total: burndown.total,
        points: burndown.points,
      }}
      velocity={velocity.map((v) => ({
        sprintId: v.sprintId,
        name: v.name,
        pointsCompleted: v.pointsCompleted,
      }))}
      cards={reportCards}
    />
  );
}
