import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";
import {
  listSprintsForWorkspace,
  listBacklogCards,
} from "@/lib/queries/sprints";
import { CreateSprintDialog } from "@/components/sprint/create-sprint-dialog";
import { SprintCard } from "@/components/sprint/sprint-card";
import { BacklogList } from "@/components/sprint/backlog-list";

export default async function BacklogPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const allSprints = await listSprintsForWorkspace(token, workspaceId);
  const cards = await listBacklogCards(token, workspaceId);

  const active = allSprints.find((s) => s.state === "active");
  const planned = allSprints.filter((s) => s.state === "planned");
  const completed = allSprints.filter((s) => s.state === "completed");

  const cardsBySprint = new Map<string | null, typeof cards>();
  for (const c of cards) {
    const k = c.sprintId ?? null;
    const arr = cardsBySprint.get(k) ?? [];
    arr.push(c);
    cardsBySprint.set(k, arr);
  }
  const backlogCards = (cardsBySprint.get(null) ?? []).filter(
    (c) => !c.archived,
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-10">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">{ws.name.toUpperCase()} / BACKLOG</span>
        <h1 className="serif-display text-5xl">Sprints &amp; backlog</h1>
        <div className="flex justify-between items-center gap-3">
          <Link
            href={`/w/${workspaceId}`}
            className="mono-meta-sm text-fg-muted hover:text-fg"
          >
            ← Back to workspace
          </Link>
          <CreateSprintDialog workspaceId={workspaceId} />
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">ACTIVE SPRINT</h2>
        {active ? (
          <SprintCard
            sprint={active}
            cards={cardsBySprint.get(active.id) ?? []}
            allSprints={allSprints}
            workspaceId={workspaceId}
          />
        ) : (
          <p className="text-sm text-fg-faint italic">
            No active sprint. Start one from the planned list.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">PLANNED ({planned.length})</h2>
        <div className="space-y-3">
          {planned.map((s) => (
            <SprintCard
              key={s.id}
              sprint={s}
              cards={cardsBySprint.get(s.id) ?? []}
              allSprints={allSprints}
              workspaceId={workspaceId}
              activeExists={Boolean(active)}
            />
          ))}
          {planned.length === 0 && (
            <p className="text-sm text-fg-faint italic">No planned sprints.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">
          BACKLOG ({backlogCards.length})
        </h2>
        <BacklogList cards={backlogCards} sprints={allSprints} />
      </section>

      {completed.length > 0 && (
        <section className="space-y-3 opacity-70">
          <h2 className="mono-meta text-fg-muted">
            COMPLETED ({completed.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {completed.map((s) => (
              <li key={s.id} className="border border-hairline rounded-lg p-3">
                <span className="font-medium">{s.name}</span>
                {s.completedAt && (
                  <span className="ml-2 mono-meta-sm text-fg-faint">
                    {new Date(s.completedAt).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
