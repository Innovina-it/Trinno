import { formatDate } from "@/lib/format-date";
import { EMAIL_KIND_LABELS, type NotificationKind } from "@/lib/notifications/email-labels";
function formatRelative(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - t.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dDays = Math.floor(h / 24);
  if (dDays < 30) return `${dDays}d`;
  return formatDate(t);
}

function kindVerb(kind: string): string {
  return EMAIL_KIND_LABELS[kind as NotificationKind]?.subject ?? kind;
}

function dayBucket(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const tDay = new Date(t);
  tDay.setHours(0, 0, 0, 0);
  if (tDay.getTime() === today.getTime()) return "TODAY";
  if (tDay.getTime() === yest.getTime()) return "YESTERDAY";
  return formatDate(tDay);
}

export function GadgetRecentActivity({
  rows,
}: {
  rows: Array<{
    id: string;
    type: string;
    payload: unknown;
    createdAt: Date | string;
    actorName: string | null;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-4 space-y-1">
        <p className="mono-meta-sm text-fg-faint">QUIET</p>
        <p className="text-sm text-fg-muted">No recent activity.</p>
      </div>
    );
  }

  // Group rows by day bucket while preserving order.
  const groups: Array<{ label: string; rows: typeof rows }> = [];
  for (const r of rows) {
    const label = dayBucket(r.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.rows.push(r);
    } else {
      groups.push({ label, rows: [r] });
    }
  }

  return (
    <div
      className="space-y-3 overflow-y-auto max-h-full"
      data-testid="gadget-recent-list"
    >
      {groups.map((g) => (
        <section key={g.label} className="space-y-1.5">
          <div className="mono-meta-sm text-fg-faint">{g.label}</div>
          <ul className="space-y-1">
            {g.rows.map((r) => {
              const verb = kindVerb(r.type);
              return (
                <li
                  key={r.id}
                  className="text-sm flex items-baseline justify-between gap-2 leading-snug"
                >
                  <span className="truncate text-fg">
                    <span className="font-medium">
                      {r.actorName ?? "Someone"}
                    </span>
                    <span className="text-fg-muted"> {verb}</span>
                  </span>
                  <span className="mono-meta-sm text-fg-faint shrink-0 tabular-nums">
                    {formatRelative(r.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
