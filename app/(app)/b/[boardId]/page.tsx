import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getBoard } from "@/lib/queries/boards";
import { Button } from "@/components/ui/button";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const b = await getBoard(token, boardId);
  if (!b) notFound();

  const bg = b.backgroundKind === "color" ? b.backgroundValue : "#0079bf";
  return (
    <main
      className="-m-6 min-h-[calc(100vh-3rem)] p-6 text-white"
      style={{ background: bg }}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        <Button
          render={<Link href={`/b/${boardId}/settings`} />}
          nativeButton={false}
          variant="secondary"
          size="sm"
        >
          Board settings
        </Button>
      </div>
      <p className="mt-8 opacity-80 text-sm">
        Lists and cards land in plan #3.
      </p>
    </main>
  );
}
