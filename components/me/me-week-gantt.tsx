"use client";

import Link from "next/link";
import type { MyWeekCard } from "@/lib/queries/me-week";
import { formatDate } from "@/lib/format-date";
import { STATUS_LABEL, statusBarFill, type StatusKind } from "@/lib/status";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";

// Workflow order for the legend. `done` carries completed cards too.
const STATUS_ORDER: StatusKind[] = [
  "todo",
  "in_progress",
  "review",
  "done",
  "blocked",
];

// Compact, muted status key. Status is the only sanctioned chroma (DESIGN.md),
// and bars show the card title not its state, so the legend is what makes the
// colours decodable — paired with the per-status texture it satisfies "status
// never by colour alone". Swatches render static (no pulse) to keep idle UI
// quiet.
function StatusLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-3"
      data-testid="me-week-legend"
    >
      {STATUS_ORDER.map((s) => {
        const f = statusBarFill(s, { motion: false });
        return (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-3 w-5 rounded-[2px] border border-fg/10 ${f.className}`}
              style={f.style}
            />
            <span className="mono-meta-sm uppercase tracking-[0.1em] text-fg-faint">
              {STATUS_LABEL[s]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

const DAY_PX = 56;
const MIN_BAR_PX = 28;
const CAPACITY_H = 24; // height in px for capacity strip

// ── inline daily-bucket helper ────────────────────────────────────────────
// Returns an array of 14 load values (index 0 = today).
// Each card contributes 1/(totalSpanDays) to each day it covers inside the window.
function dailyLoads(cards: MyWeekCard[], windowStart: Date): number[] {
  const loads = Array<number>(14).fill(0);
  for (const card of cards) {
    const spanMs = card.targetDate.getTime() - card.startDate.getTime();
    const spanDays = Math.max(1, Math.round(spanMs / 86_400_000) + 1);
    const fraction = 1 / spanDays;

    for (let d = 0; d < 14; d++) {
      const dayStart = new Date(windowStart.getTime() + d * 86_400_000);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      if (card.startDate < dayEnd && card.targetDate >= dayStart) {
        loads[d] += fraction;
      }
    }
  }
  return loads;
}

// ── date helpers ──────────────────────────────────────────────────────────
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function clampDate(d: Date, lo: Date, hi: Date): Date {
  if (d < lo) return lo;
  if (d > hi) return hi;
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ── component ─────────────────────────────────────────────────────────────
export function MeWeekGantt({ cards }: { cards: MyWeekCard[] }) {
  const now = new Date();
  const today = utcMidnight(now);
  const windowEnd = new Date(today.getTime() + 13 * 86_400_000); // inclusive last day

  // Build 14-day header labels
  const days: Array<{ label: string; date: Date }> = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getTime() + i * 86_400_000);
    const dow = d.getUTCDay(); // 0=Sun
    const isMonday = dow === 1;
    const label = isMonday
      ? `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}`
      : String(d.getUTCDate());
    days.push({ label, date: d });
  }

  const loads = dailyLoads(cards, today);
  const maxLoad = Math.max(1, ...loads);

  const totalWidth = DAY_PX * 14;

  if (cards.length === 0) {
    return (
      <div
        data-testid="me-week-gantt"
        className="flex items-center justify-center py-12 text-fg-muted mono-meta-sm tracking-widest"
      >
        NO DATED ASSIGNMENTS THIS WEEK
      </div>
    );
  }

  return (
    <div data-testid="me-week-gantt">
      <StatusLegend />
      <div className="overflow-x-auto">
      <div style={{ minWidth: totalWidth }} className="relative">

        {/* ── capacity strip ──────────────────────────────────────────── */}
        <div
          className="relative flex border-b border-border/30"
          style={{ height: CAPACITY_H }}
        >
          {loads.map((load, i) => {
            const heightPct = (load / maxLoad) * 100;
            return (
              <div
                key={i}
                style={{ width: DAY_PX, position: "relative" }}
                className="flex items-end justify-center"
              >
                <div
                  style={{
                    width: DAY_PX - 4,
                    height: `${heightPct}%`,
                    background: "var(--accent, oklch(0.6 0.2 250))",
                    opacity: 0.18,
                    borderRadius: 2,
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* ── header row ──────────────────────────────────────────────── */}
        <div className="relative flex border-b border-border">
          {days.map(({ label, date }, i) => {
            const isToday = diffDays(today, date) === 0;
            return (
              <div
                key={i}
                style={{ width: DAY_PX, flexShrink: 0 }}
                className={`relative flex flex-col items-center py-1 text-[10px] font-mono ${
                  isToday ? "text-accent font-semibold" : "text-fg-muted"
                }`}
              >
                {label}
                {/* today accent line */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute bottom-0 left-1/2 w-px bg-accent"
                    style={{ top: 0, transform: "translateX(-50%)", zIndex: 10 }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── card rows ───────────────────────────────────────────────── */}
        <div className="relative">
          {/* today vertical line behind rows */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent/40"
            style={{ left: DAY_PX * 0 + DAY_PX / 2, zIndex: 0 }}
          />

          {cards.map((card) => {
            const barStart = clampDate(card.startDate, today, windowEnd);
            const barEnd = clampDate(card.targetDate, today, windowEnd);

            const offsetDays = diffDays(today, barStart);
            const spanDays = diffDays(barStart, barEnd) + 1;

            const leftPx = offsetDays * DAY_PX;
            const widthPx = Math.max(MIN_BAR_PX, spanDays * DAY_PX - 2);

            const isDone = card.completedAt !== null;
            // Completed cards read as the "done" hatch even if their list
            // isn't mapped to done — completion is the strongest signal.
            // Otherwise the bar takes its list's status fill.
            const fill = statusBarFill(isDone ? "done" : card.statusKind);
            // Priority rides as a 3px left-edge stripe (DESIGN.md: priority is
            // a stripe/dot, never a fill) — same grammar as the roadmap bar, so
            // status (fill) and priority (stripe) read on one bar.
            const priorityDot = card.priority
              ? PRIORITY_TINT[card.priority as CardPriority].dot
              : null;
            const statusLabel = isDone
              ? "done"
              : card.statusKind
                ? STATUS_LABEL[card.statusKind]
                : null;

            const tooltip = [
              card.title,
              statusLabel ? `[${statusLabel}]` : null,
              card.priority ? card.priority.toUpperCase() : null,
              `${card.workspaceName} / ${card.boardTitle}`,
              `${formatDate(card.startDate)}→${formatDate(card.targetDate)}`,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div
                key={card.id}
                className="relative flex items-center border-b border-border/20"
                style={{ height: 36 }}
              >
                <Link
                  href={`/b/${card.boardId}/c/${card.id}`}
                  title={tooltip}
                  data-testid="me-week-bar"
                  data-card-id={card.id}
                  className={[
                    "absolute flex items-center px-2 rounded text-[11px] font-medium overflow-hidden whitespace-nowrap cursor-pointer transition-opacity border border-fg/10 text-fg",
                    fill.className,
                    isDone
                      ? "line-through opacity-60"
                      : "opacity-95 hover:opacity-100",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left: leftPx,
                    width: widthPx,
                    height: 28,
                    zIndex: 1,
                    ...fill.style,
                  }}
                >
                  {priorityDot && (
                    <span
                      aria-hidden
                      data-testid="me-week-bar-priority-stripe"
                      data-priority={card.priority}
                      className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l pointer-events-none ${priorityDot}`}
                    />
                  )}
                  <span className="truncate">{card.title}</span>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}
