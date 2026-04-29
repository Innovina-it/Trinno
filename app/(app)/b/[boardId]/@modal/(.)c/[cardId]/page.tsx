import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { cards } from "@/lib/db/schema";
import { requireUser, getSessionToken } from "@/lib/auth";
import { CardModal } from "@/components/board/card-modal";
import { CardActivity } from "@/components/board/card/card-activity";

export default async function InterceptedCardPage({
  params,
}: {
  params: Promise<{ boardId: string; cardId: string }>;
}) {
  const { cardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const rows = await dbAsUser(token, async (tx) =>
    tx.select().from(cards).where(eq(cards.id, cardId)),
  );
  if (rows.length === 0) notFound();
  const c = rows[0];
  return (
    <CardModal
      asDialog
      card={{ id: c.id, title: c.title, description: c.description }}
    >
      <CardActivity cardId={c.id} />
    </CardModal>
  );
}
