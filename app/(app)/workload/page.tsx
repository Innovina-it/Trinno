import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkload } from "@/lib/queries/workload";
import { WorkloadView } from "@/components/workload/workload-view";

// Cross-workspace people-time view. Lanes = users, bars = their dated
// cards across every workspace they touch. Server-rendered so the heavy
// query runs once at request time and the client just paints.
export default async function WorkloadPage() {
  await requireUser();
  const token = (await getSessionToken())!;
  const { cards, profiles } = await listWorkload(token);

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-8">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">WORKLOAD / ALL PROJECTS</span>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="serif-display text-5xl">Workload</h1>
          <span className="mono-meta text-fg-muted" data-testid="workload-card-count">
            {cards.length} {cards.length === 1 ? "ASSIGNMENT" : "ASSIGNMENTS"} ·{" "}
            {profiles.length} {profiles.length === 1 ? "PERSON" : "PEOPLE"}
          </span>
        </div>
      </header>
      <WorkloadView cards={cards} profiles={profiles} />
    </div>
  );
}
