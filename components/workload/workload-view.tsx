"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { WorkloadCard, WorkloadProfile } from "@/lib/queries/workload";
import { bucketsBetween, fillBuckets } from "@/lib/workload/buckets";
import { Select } from "@/components/ui/select";
import { useWorkloadSync } from "@/hooks/use-workload-sync";

const PX_PER_DAY = 8;
const ROW_HEIGHT = 36;
const HISTO_HEIGHT = 18;
const LANE_LABEL_WIDTH = 180;
const MS_DAY = 86_400_000;

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function WorkloadView({
  cards,
  profiles,
}: {
  cards: WorkloadCard[];
  profiles: WorkloadProfile[];
}) {
  // Live: any cards / card_members change, refresh the RSC payload.
  useWorkloadSync();
  const [wsFilter, setWsFilter] = useState<string>("");

  const filtered = useMemo(() => {
    return wsFilter ? cards.filter((c) => c.workspaceId === wsFilter) : cards;
  }, [cards, wsFilter]);

  // Workspace options drawn from the unfiltered set so the list is stable.
  const workspaces = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cards) m.set(c.workspaceId, c.workspaceName);
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [cards]);

  // Group by user. Empty profiles list = nothing to render.
  const byUser = useMemo(() => {
    const m = new Map<string, WorkloadCard[]>();
    for (const c of filtered) {
      const arr = m.get(c.userId);
      if (arr) arr.push(c);
      else m.set(c.userId, [c]);
    }
    return m;
  }, [filtered]);

  // Date range: span of all cards padded by a week each side, fall back
  // to today + 14 days when nothing is on the timeline.
  const range = useMemo(() => {
    if (filtered.length === 0) {
      const today = startOfDayUtc(new Date());
      return { start: today, end: new Date(today.getTime() + 14 * MS_DAY) };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const c of filtered) {
      const s = c.startDate.getTime();
      const t = c.targetDate.getTime();
      if (s < min) min = s;
      if (t > max) max = t;
    }
    return {
      start: new Date(min - 7 * MS_DAY),
      end: new Date(max + 7 * MS_DAY),
    };
  }, [filtered]);

  const totalDays =
    Math.ceil((range.end.getTime() - range.start.getTime()) / MS_DAY) + 1;
  const gridWidth = totalDays * PX_PER_DAY;

  // Pre-compute week buckets across the whole range — re-used for every
  // user's histogram so layout columns line up.
  const weekBuckets = useMemo(() => bucketsBetween(range.start, range.end), [
    range.start,
    range.end,
  ]);

  const profileById = useMemo(() => {
    const m = new Map<string, WorkloadProfile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const sortedUsers = useMemo(() => {
    return Array.from(byUser.keys())
      .map((uid) => ({
        id: uid,
        name: profileById.get(uid)?.displayName ?? "Unknown",
        count: byUser.get(uid)!.length,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [byUser, profileById]);

  function xFor(d: Date): number {
    return ((d.getTime() - range.start.getTime()) / MS_DAY) * PX_PER_DAY;
  }

  return (
    <section className="space-y-4" data-testid="workload-view">
      <div className="flex items-center gap-2">
        <span className="mono-meta-sm text-fg-muted">WORKSPACE</span>
        <Select
          value={wsFilter}
          onValueChange={setWsFilter}
          data-testid="workload-workspace-filter"
          options={[
            { value: "", label: `ALL (${cards.length})` },
            ...workspaces.map((w) => ({
              value: w.id,
              label: w.name.toUpperCase(),
            })),
          ]}
          size="sm"
          className="min-w-32"
        />
      </div>

      {sortedUsers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline-hi p-12 text-center mono-meta text-fg-muted">
          NO DATED ASSIGNMENTS YET
          <p className="mt-2 normal-case tracking-normal text-sm text-fg-faint">
            Cards land here when they have a start + target date and an owner
            or assignees.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl glass overflow-hidden">
          <div className="overflow-x-auto">
            <div
              style={{
                width: LANE_LABEL_WIDTH + gridWidth,
                minWidth: "100%",
              }}
            >
              {/* Header strip: month-day labels every 7 days. */}
              <div
                className="sticky top-0 z-10 flex border-b border-hairline bg-[color:var(--surface-strong)]/95 backdrop-blur"
                style={{ height: 36 }}
              >
                <div
                  className="shrink-0 border-r border-hairline px-3 mono-meta-sm text-fg-faint flex items-center"
                  style={{ width: LANE_LABEL_WIDTH }}
                >
                  PERSON
                </div>
                <div className="relative" style={{ width: gridWidth }}>
                  {weekBuckets.map((b) => {
                    const x = xFor(b.start);
                    return (
                      <div
                        key={`${b.isoYear}-${b.isoWeek}`}
                        className="absolute inset-y-0 border-l border-hairline pl-1.5 mono-meta-sm text-fg-faint flex items-center"
                        style={{ left: x, width: 7 * PX_PER_DAY }}
                      >
                        {fmtDay(b.start)}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lanes — one per user. Histogram strip on top, bars below. */}
              {sortedUsers.map((u) => {
                const userCards = byUser.get(u.id)!;
                const histo = fillBuckets(
                  bucketsBetween(range.start, range.end),
                  userCards.map((c) => ({
                    id: c.id,
                    startDate: c.startDate,
                    targetDate: c.targetDate,
                    estimateMin: c.estimateMin,
                  })),
                );
                const peak = Math.max(1, ...histo.map((b) => b.load));
                return (
                  <div
                    key={u.id}
                    className="flex border-b border-hairline last:border-b-0"
                    data-testid="workload-lane"
                    data-user-id={u.id}
                  >
                    <div
                      className="shrink-0 border-r border-hairline px-3 py-2 flex flex-col justify-center"
                      style={{ width: LANE_LABEL_WIDTH }}
                    >
                      <span className="text-fg text-sm font-medium truncate">
                        {u.name}
                      </span>
                      <span className="mono-meta-sm text-fg-faint">
                        {u.count} CARDS
                      </span>
                    </div>
                    <div
                      className="relative"
                      style={{
                        width: gridWidth,
                        height: HISTO_HEIGHT + ROW_HEIGHT,
                      }}
                    >
                      {/* Histogram band */}
                      <div
                        className="absolute inset-x-0 top-0 border-b border-hairline/60"
                        style={{ height: HISTO_HEIGHT }}
                      >
                        {histo.map((b) => {
                          const x = xFor(b.start);
                          const h = (b.load / peak) * (HISTO_HEIGHT - 2);
                          return (
                            <div
                              key={`${u.id}-${b.isoYear}-${b.isoWeek}`}
                              className="absolute bottom-0 bg-[color:var(--accent-violet)]/40"
                              style={{
                                left: x + 1,
                                width: 7 * PX_PER_DAY - 2,
                                height: h,
                              }}
                              title={`Week ${b.isoWeek}: ${Math.round(b.load)} ${
                                b.load > 0 && userCards.some((c) => c.estimateMin != null)
                                  ? "min"
                                  : "card-frac"
                              }`}
                            />
                          );
                        })}
                      </div>

                      {/* Bars */}
                      <div
                        className="absolute inset-x-0"
                        style={{ top: HISTO_HEIGHT, height: ROW_HEIGHT }}
                      >
                        {userCards.map((c, i) => {
                          const x = xFor(c.startDate);
                          const w = Math.max(
                            PX_PER_DAY,
                            xFor(new Date(c.targetDate.getTime() + MS_DAY)) - x,
                          );
                          return (
                            <Link
                              key={`${c.id}-${i}`}
                              href={`/b/${c.boardId}/c/${c.id}`}
                              className="absolute top-1 h-7 rounded-md border border-hairline-hi bg-[color:var(--surface-hi)] px-1.5 text-xs leading-7 text-fg overflow-hidden whitespace-nowrap hover:border-[color:var(--accent-violet)]/60 hover:bg-[color:var(--surface-strong)]"
                              style={{ left: x, width: w }}
                              data-testid="workload-bar"
                              data-card-id={c.id}
                              data-role={c.role}
                              title={`${c.title} · ${c.workspaceName} / ${c.boardTitle}`}
                            >
                              <span
                                className="mr-1 inline-block size-1.5 rounded-full align-middle"
                                style={{
                                  background:
                                    c.role === "owner"
                                      ? "var(--accent-magenta)"
                                      : "var(--accent-cyan)",
                                }}
                                aria-hidden
                              />
                              {c.title}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <p className="mono-meta-sm text-fg-faint">
        OWNER ROLES SHOW IN MAGENTA · COLLABORATORS IN CYAN · WIDTH = SPAN ·
        HISTOGRAM = PER-WEEK LOAD (ESTIMATE MIN OR CARD-FRACTION).
      </p>
    </section>
  );
}
