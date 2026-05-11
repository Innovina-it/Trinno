"use client";
import { useEffect, useState } from "react";
import { History, ArrowRight } from "lucide-react";
import type { CardHistoryRow } from "@/lib/queries/card-history";

// Card history feed. Lazy-fetches via /api/card-history?cardId=… so the
// initial card-modal payload stays small for cards with hundreds of
// audit rows.

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  priority: "Priority",
  owner_id: "Owner",
  start_date: "Start date",
  target_date: "Target date",
  due_date: "Due date",
  completed_at: "Completion",
  sprint_id: "Sprint",
  parent_card_id: "Parent",
  type: "Type",
  story_points: "Story points",
  estimate_min: "Estimate (min)",
};

function fmtRel(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function shortId(v: string | null): string {
  if (!v) return "—";
  // Card ids / user ids show as last 6 hex chars; keeps rows scannable.
  return v.length > 12 ? `…${v.slice(-6)}` : v;
}

function fmtVal(field: string, v: string | null): string {
  if (v === null || v === "") return "—";
  if (field === "owner_id" || field === "parent_card_id" || field === "sprint_id") {
    return shortId(v);
  }
  if (
    field === "start_date" ||
    field === "target_date" ||
    field === "due_date" ||
    field === "completed_at"
  ) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return d.toISOString().slice(0, 10);
  }
  return v.length > 40 ? v.slice(0, 40) + "…" : v;
}

export function CardHistorySection({ cardId }: { cardId: string }) {
  const [rows, setRows] = useState<CardHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/card-history?cardId=${encodeURIComponent(cardId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { rows: CardHistoryRow[] }) => {
        if (cancelled) return;
        // JSON revives Dates as strings; coerce.
        const revived = data.rows.map((r) => ({
          ...r,
          at: new Date(r.at as unknown as string),
          ...(r.kind === "sprint"
            ? {
                assignedAt: new Date(r.assignedAt as unknown as string),
                removedAt: r.removedAt
                  ? new Date(r.removedAt as unknown as string)
                  : null,
              }
            : {}),
        })) as CardHistoryRow[];
        setRows(revived);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  return (
    <section className="space-y-3" data-testid="history-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted inline-flex items-center gap-1.5">
          <History className="size-3" />
          History
        </h3>
        {loading && (
          <span className="mono-meta-sm text-fg-faint">LOADING…</span>
        )}
        {rows !== null && (
          <span className="mono-meta-sm text-fg-faint tabular-nums">
            {rows.length} {rows.length === 1 ? "EVENT" : "EVENTS"}
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-[color:var(--accent-magenta)]">
          Failed to load: {error}
        </p>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="mono-meta-sm text-fg-faint">NO CHANGES YET</p>
      )}

      {rows !== null && rows.length > 0 && (
        <ol className="space-y-1.5" data-testid="history-list">
          {rows.map((r) => (
            <li
              key={`${r.kind}:${r.id}`}
              className="flex items-baseline gap-2 text-xs leading-snug"
              data-testid="history-row"
              data-kind={r.kind}
            >
              <span
                className="mono-meta-sm text-fg-faint w-20 shrink-0 tabular-nums"
                title={r.at.toISOString()}
              >
                {fmtRel(r.at)}
              </span>
              {r.kind === "field" ? (
                <>
                  <span className="text-fg-muted shrink-0">
                    {FIELD_LABEL[r.field] ?? r.field}
                  </span>
                  <span className="text-fg-faint">
                    {fmtVal(r.field, r.oldValue)}
                  </span>
                  <ArrowRight className="size-3 text-fg-faint shrink-0" />
                  <span className="text-fg">
                    {fmtVal(r.field, r.newValue)}
                  </span>
                  {r.actorName && (
                    <span className="ml-auto mono-meta-sm text-fg-faint truncate">
                      by {r.actorName}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-fg-muted shrink-0">Sprint</span>
                  <span className="text-fg">
                    {r.sprintName ?? "Backlog"}
                  </span>
                  <span className="mono-meta-sm text-fg-faint">
                    {r.removedAt ? "→ left" : "active"}
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
