import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards, boards } from "@/lib/db/schema";
import { requireUser, getSessionToken } from "@/lib/auth";
import { CardModal } from "@/components/board/card-modal";
import { CardActivity } from "@/components/board/card/card-activity";
import { listSprintsForWorkspace } from "@/lib/queries/sprints";
import { listMembers } from "@/lib/queries/workspaces";

export default async function CardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { cardId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const rows = await dbAsUser(token, async (tx) =>
    tx.select().from(cards).where(eq(cards.id, cardId)),
  );
  if (rows.length === 0) notFound();
  const c = rows[0];

  const [board] = await dbAsUser(token, async (tx) =>
    tx.select({ workspaceId: boards.workspaceId }).from(boards).where(eq(boards.id, c.boardId)),
  );
  const sprints = board
    ? await listSprintsForWorkspace(token, board.workspaceId)
    : [];
  const members = board ? await listMembers(token, board.workspaceId) : [];
  const currentMember = members.find((m) => m.userId === user.id);
  const canManageSprints =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  return (
    <CardModal
      card={{
        id: c.id,
        title: c.title,
        description: c.description,
        type: c.type,
        parentCardId: c.parentCardId,
        listId: c.listId,
        boardId: c.boardId,
        sprintId: c.sprintId,
        storyPoints: c.storyPoints,
        estimateMin: c.estimateMin,
        spentMin: c.spentMin,
        startDate: c.startDate,
        targetDate: c.targetDate,
        priority: c.priority,
        coverKind: c.coverKind as "none" | "color" | "image",
        coverValue: c.coverValue,
      }}
      sprints={sprints.map((s) => ({ id: s.id, name: s.name, state: s.state }))}
      workspaceId={board?.workspaceId}
      canManageSprints={canManageSprints}
    >
      <CardActivity cardId={c.id} workspaceId={board?.workspaceId} />
    </CardModal>
  );
}
