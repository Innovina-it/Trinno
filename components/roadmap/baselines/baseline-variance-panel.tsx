"use client";

import { X } from "lucide-react";
import type { CardVariance, VarianceResult } from "@/lib/baselines/types";

type ProfileMap = Record<string, { displayName?: string | null }>;

export function BaselineVariancePanel({
  variance,
  baselineName,
  profilesById,
  onClose,
}: {
  variance: VarianceResult;
  baselineName: string;
  profilesById?: ProfileMap;
  onClose: () => void;
}) {
  const r = variance.rollup;

  const byStatus = (status: CardVariance["status"]) =>
    variance.cards.filter((c) => c.status === status);

  const slipped = byStatus("slipped")
    .slice()
    .sort((a, b) => (b.targetDeltaDays ?? 0) - (a.targetDeltaDays ?? 0));
  const pulledIn = byStatus("pulled_in");
  const completedSince = byStatus("completed_since");
  const added = byStatus("added");
  const removed = byStatus("removed");
  const reordered = byStatus("reordered");

  const milestones = variance.milestones.filter((m) => m.status !== "unchanged");

  const resolveName = (id: string) => profilesById?.[id]?.displayName ?? id;

  function assigneeChanges(c: CardVariance) {
    const parts: { key: string; sign: "+" | "−"; name: string }[] = [];
    for (const id of c.assigneesAdded) {
      parts.push({ key: `+${id}`, sign: "+", name: resolveName(id) });
    }
    for (const id of c.assigneesRemoved) {
      parts.push({ key: `-${id}`, sign: "−", name: resolveName(id) });
    }
    if (parts.length === 0) return null;
    return (
      <span className="mt-0.5 block text-[11px] text-fg-faint">
        {parts.map((p) => (
          <span key={p.key} className="mr-2 inline-block">
            <span
              className={
                p.sign === "+"
                  ? "text-[color:var(--accent-emerald)]"
                  : "text-[color:var(--accent-rose)]"
              }
            >
              {p.sign}
            </span>
            {p.name}
          </span>
        ))}
      </span>
    );
  }

  function CardRow({
    card,
    delta,
    deltaClass,
  }: {
    card: CardVariance;
    delta?: string;
    deltaClass?: string;
  }) {
    return (
      <li
        data-testid={`variance-row-${card.cardId}`}
        className="flex items-start justify-between gap-3 border-b border-hairline py-1.5 last:border-b-0"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-fg">{card.title}</span>
          {assigneeChanges(card)}
        </span>
        {delta != null && (
          <span className={`shrink-0 text-xs tabular-nums ${deltaClass ?? ""}`}>
            {delta}
          </span>
        )}
      </li>
    );
  }

  function Section({
    title,
    rows,
    render,
  }: {
    title: string;
    rows: CardVariance[];
    render: (c: CardVariance) => React.ReactNode;
  }) {
    if (rows.length === 0) return null;
    return (
      <section className="px-4 py-3">
        <h3 className="mb-1.5 mono-meta-sm tracking-[0.14em] text-fg-faint">
          {title} · {rows.length}
        </h3>
        <ul>{rows.map(render)}</ul>
      </section>
    );
  }

  return (
    <aside
      data-testid="baseline-variance-panel"
      className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-hairline bg-[color:var(--surface)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <div className="mono-meta-sm tracking-[0.14em] text-fg-faint">
            COMPARING
          </div>
          <div className="truncate text-sm font-medium text-fg">
            {baselineName}
          </div>
          <div className="mt-1 text-[11px] text-fg-muted tabular-nums">
            {r.slipped} slipped · {r.pulledIn} pulled in · {r.added} added ·{" "}
            {r.removed} removed · {r.completedSince} completed
            {r.worstSlipDays > 0 ? ` · worst +${r.worstSlipDays}d` : ""}
          </div>
        </div>
        <button
          type="button"
          data-testid="baseline-variance-close"
          aria-label="Close variance panel"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-fg-faint hover:bg-[rgb(255_255_255/0.08)] hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-hairline">
        <Section
          title="Slipped"
          rows={slipped}
          render={(c) => (
            <CardRow
              key={c.cardId}
              card={c}
              delta={`+${c.targetDeltaDays ?? 0}d`}
              deltaClass="text-[color:var(--accent-rose)]"
            />
          )}
        />
        <Section
          title="Pulled in"
          rows={pulledIn}
          render={(c) => (
            <CardRow
              key={c.cardId}
              card={c}
              delta={`${c.targetDeltaDays ?? 0}d`}
              deltaClass="text-[color:var(--accent-emerald)]"
            />
          )}
        />
        <Section
          title="Completed since"
          rows={completedSince}
          render={(c) => <CardRow key={c.cardId} card={c} />}
        />
        <Section
          title="Added"
          rows={added}
          render={(c) => <CardRow key={c.cardId} card={c} />}
        />
        <Section
          title="Removed"
          rows={removed}
          render={(c) => <CardRow key={c.cardId} card={c} />}
        />
        <Section
          title="Reordered"
          rows={reordered}
          render={(c) => <CardRow key={c.cardId} card={c} />}
        />

        {milestones.length > 0 && (
          <section className="px-4 py-3">
            <h3 className="mb-1.5 mono-meta-sm tracking-[0.14em] text-fg-faint">
              Milestones · {milestones.length}
            </h3>
            <ul>
              {milestones.map((m) => {
                const delta = m.dateDeltaDays ?? 0;
                const label =
                  m.status === "added"
                    ? "added"
                    : m.status === "removed"
                      ? "removed"
                      : `moved (${delta > 0 ? "+" : ""}${delta}d)`;
                return (
                  <li
                    key={m.milestoneId}
                    className="flex items-start justify-between gap-3 border-b border-hairline py-1.5 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {m.name}
                    </span>
                    <span
                      className={`shrink-0 text-xs tabular-nums ${
                        m.status === "removed"
                          ? "text-[color:var(--accent-rose)]"
                          : m.status === "added"
                            ? "text-[color:var(--accent-emerald)]"
                            : delta > 0
                              ? "text-[color:var(--accent-rose)]"
                              : "text-fg-muted"
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
