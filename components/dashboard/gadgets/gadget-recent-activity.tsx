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
  return t.toISOString().slice(0, 10);
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
      <div className="text-fg-muted text-sm italic">No recent activity.</div>
    );
  }
  return (
    <ul className="space-y-1.5 overflow-y-auto max-h-full" data-testid="gadget-recent-list">
      {rows.map((r) => (
        <li
          key={r.id}
          className="text-sm flex items-baseline justify-between gap-2"
        >
          <span className="truncate">
            <span className="text-fg-muted">{r.actorName ?? "—"}</span>{" "}
            <span className="text-fg-faint mono-meta-sm">{r.type}</span>
          </span>
          <span className="mono-meta-sm text-fg-faint shrink-0 tabular-nums">
            {formatRelative(r.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
