import { requireUser, getSessionToken } from "@/lib/auth";
import {
  listMyOpenCards,
  getMyTodayCounts,
} from "@/lib/queries/me-cards";
import { listMyWeekCards } from "@/lib/queries/me-week";
import { listMyActiveSprints } from "@/lib/queries/me-sprints";
import { computeBurndown, type BurndownPoint } from "@/lib/queries/sprints-stats";
import {
  listMyInbox,
  listMyWatchlist,
  listBlockersOnMyCards,
} from "@/lib/queries/me-inbox";
import { MeTodayStrip } from "@/components/me/me-today-strip";
import { MeOpenCards } from "@/components/me/me-open-cards";
import { MeWeekGantt } from "@/components/me/me-week-gantt";
import { MeActiveSprints } from "@/components/me/me-active-sprints";
import { MeInbox } from "@/components/me/me-inbox";
import { MeWatchlist } from "@/components/me/me-watchlist";
import { MeBlocked } from "@/components/me/me-blocked";

// Personal home dashboard. Single curated read-only page surfacing every
// site feature actionable for the current user across all workspaces.
// Distinct from `/dashboards/[id]` (configurable shared dashboards).

export default async function MeHomePage() {
  const user = await requireUser();
  const token = (await getSessionToken())!;

  // Run independent queries in parallel; page.tsx is a server component
  // so each await is a network round-trip we don't want to serialize.
  const [
    todayCounts,
    openCards,
    weekCards,
    activeSprints,
    inboxItems,
    watchlist,
    blockers,
  ] = await Promise.all([
    getMyTodayCounts(token),
    listMyOpenCards(token),
    listMyWeekCards(token),
    listMyActiveSprints(token),
    listMyInbox(token),
    listMyWatchlist(token),
    listBlockersOnMyCards(token),
  ]);

  // Burndowns are sprint-by-sprint; do them in parallel after we know
  // the active sprint set.
  const burndownEntries = await Promise.all(
    activeSprints.map(async (s) => {
      const r = await computeBurndown(token, s.id);
      return [s.id, r.points] as const;
    }),
  );
  const burndowns: Record<string, BurndownPoint[]> = Object.fromEntries(
    burndownEntries,
  );

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 md:px-6 py-6 md:py-10 space-y-8">
      <header className="space-y-3 border-b border-hairline pb-6">
        <span className="chip">HOME / {user.email?.toUpperCase()}</span>
        <h1 className="serif-display text-5xl">Today</h1>
      </header>

      <MeTodayStrip
        overdue={todayCounts.overdue}
        dueToday={todayCounts.dueToday}
        completedToday={todayCounts.completedToday}
      />

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">My week</h2>
        <MeWeekGantt cards={weekCards} />
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta text-fg-muted">Open cards</h2>
        <MeOpenCards cards={openCards} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="mono-meta text-fg-muted">Active sprints</h2>
          <MeActiveSprints sprints={activeSprints} burndowns={burndowns} />
        </div>
        <div className="space-y-3">
          <h2 className="mono-meta text-fg-muted">Blocking your work</h2>
          <MeBlocked rows={blockers} />
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="mono-meta text-fg-muted">Inbox</h2>
          <MeInbox items={inboxItems} />
        </div>
        <div className="space-y-3">
          <h2 className="mono-meta text-fg-muted">Watching</h2>
          <MeWatchlist cards={watchlist} />
        </div>
      </section>
    </div>
  );
}
