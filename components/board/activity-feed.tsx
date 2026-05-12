import Link from "next/link";
import {
  Archive,
  CalendarRange,
  CornerDownRight,
  FileText,
  GitBranch,
  ListChecks,
  ListPlus,
  MessageSquare,
  Move,
  Pencil,
  Tag,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { listActivityForBoard } from "@/lib/queries/activity";
import { formatDate } from "@/lib/format-date";
import { getSessionToken } from "@/lib/auth";

// Each event maps to a glyph + structured verb. Verb is past-tense, terse,
// no object suffix (object renders as a separate inline subject below).
const EVENT_MAP: Record<string, { icon: LucideIcon; verb: string }> = {
  "list.create": { icon: ListPlus, verb: "added list" },
  "list.rename": { icon: Pencil, verb: "renamed list" },
  "list.archive": { icon: Archive, verb: "archived list" },
  "list.unarchive": { icon: ListPlus, verb: "restored list" },
  "card.create": { icon: ListPlus, verb: "added" },
  "card.rename": { icon: Pencil, verb: "renamed" },
  "card.description": { icon: FileText, verb: "edited description on" },
  "card.move": { icon: Move, verb: "moved" },
  "card.archive": { icon: Archive, verb: "archived" },
  "card.unarchive": { icon: ListPlus, verb: "restored" },
  "card.due": { icon: CalendarRange, verb: "set due on" },
  "card.dates": { icon: CalendarRange, verb: "scheduled" },
  "card.roadmap_order": { icon: GitBranch, verb: "reordered" },
  "card.label.add": { icon: Tag, verb: "labeled" },
  "card.label.remove": { icon: Tag, verb: "unlabeled" },
  "card.member.assign": { icon: UserPlus, verb: "assigned" },
  "card.member.unassign": { icon: UserMinus, verb: "unassigned" },
  "comment.create": { icon: MessageSquare, verb: "commented on" },
  "comment.edit": { icon: MessageSquare, verb: "edited comment on" },
  "comment.delete": { icon: MessageSquare, verb: "deleted comment on" },
  "board.member.add": { icon: Users, verb: "added to board" },
  "board.member.remove": { icon: Users, verb: "removed from board" },
};

const FALLBACK = { icon: ListChecks, verb: "did" } as const;

function bucketLabel(d: Date, now: Date): string {
  const dayMs = 86_400_000;
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = Math.round((b - a) / dayMs);
  if (diff <= 0) return "TODAY";
  if (diff === 1) return "YESTERDAY";
  if (diff < 7) {
    return d
      .toLocaleString("en-US", { weekday: "short", timeZone: "UTC" })
      .toUpperCase();
  }
  return formatDate(d);
}

function fmtTime(d: Date): string {
  return d.toLocaleString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function isoTitle(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export async function ActivityFeed({
  boardId,
  workspaceId,
}: {
  boardId: string;
  workspaceId: string;
}) {
  const token = (await getSessionToken())!;
  const rows = await listActivityForBoard(token, boardId, 50);
  const now = new Date();

  // Pre-bucket rows by day, preserving the desc order from the query.
  const buckets: { label: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const d = new Date(r.createdAt as unknown as string);
    const label = bucketLabel(d, now);
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else buckets.push({ label, rows: [r] });
  }

  return (
    <aside
      className="w-[300px] shrink-0 max-h-[calc(100vh-9rem)] flex flex-col rounded-2xl border border-hairline bg-[color:var(--bg-1)]"
      data-testid="activity-feed"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-hairline">
        <span className="mono-meta-sm tracking-[0.14em] text-fg-faint">
          ACTIVITY
        </span>
        <span
          className="mono-meta-sm tabular-nums text-fg-faint"
          aria-label={`${rows.length} entries`}
        >
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-3 py-6">
          <p className="mono-meta-sm text-fg-faint">No activity yet.</p>
        </div>
      ) : (
        <div className="overflow-y-auto" data-testid="activity-feed-scroll">
          {buckets.map((bucket) => (
            <section key={bucket.label}>
              <h3
                className="sticky top-0 z-10 px-3 py-1.5 mono-meta-sm tracking-[0.14em] text-fg-faint bg-[color:var(--bg-1)]/95 backdrop-blur-sm border-b border-hairline"
              >
                {bucket.label}
              </h3>
              <ul className="divide-y divide-hairline">
                {bucket.rows.map((r) => {
                  const meta = EVENT_MAP[r.type] ?? FALLBACK;
                  const Icon = meta.icon;
                  const d = new Date(r.createdAt as unknown as string);
                  const targetName = (r as { targetName?: string | null })
                    .targetName;
                  const subject =
                    (r as { cardTitle?: string | null }).cardTitle ?? null;
                  const cardLink =
                    r.cardId && r.type !== "card.dates"
                      ? `/b/${boardId}/c/${r.cardId}`
                      : r.cardId && r.type === "card.dates"
                        ? `/w/${workspaceId}/roadmap?focus=${r.cardId}`
                        : null;

                  const body = (
                    <div
                      className="grid grid-cols-[2.6rem_1rem_1fr] items-baseline gap-x-2 px-3 py-2 transition-colors duration-150 hover:bg-[color:var(--surface)]"
                      title={isoTitle(d)}
                      data-testid={`activity-${r.type}`}
                    >
                      <span className="mono-meta-sm tabular-nums text-fg-faint leading-tight">
                        {fmtTime(d)}
                      </span>
                      <Icon
                        className="size-3 text-fg-muted self-center"
                        aria-hidden
                      />
                      <p className="text-[0.8125rem] leading-snug text-fg-muted min-w-0">
                        <span className="text-fg font-medium">
                          {r.actorName ?? "Someone"}
                        </span>{" "}
                        <span>{meta.verb}</span>
                        {targetName && (
                          <>
                            {" "}
                            <span className="text-fg font-medium">
                              {targetName}
                            </span>
                          </>
                        )}
                        {subject && (
                          <>
                            {" "}
                            <span
                              className="text-fg font-medium"
                              data-testid="activity-subject"
                            >
                              {subject}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  );

                  return (
                    <li key={r.id}>
                      {cardLink ? (
                        <Link href={cardLink} scroll={false} className="block">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {/* End cap so the last entry isn't flush against the panel edge. */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-hairline">
            <CornerDownRight
              className="size-3 text-fg-faint"
              aria-hidden
            />
            <span className="mono-meta-sm text-fg-faint">END OF LOG</span>
          </div>
        </div>
      )}
    </aside>
  );
}
