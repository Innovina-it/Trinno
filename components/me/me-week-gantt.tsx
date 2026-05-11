"use client";

import Link from "next/link";
import type { MyWeekCard } from "@/lib/queries/me-week";
import {
  PRIORITY_TINT,
  type CardPriority,
} from "@/components/board/card/priority-picker";

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
const MONTH_ABBREVS = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

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

function formatDateShort(d: Date): string {
  return `${MONTH_ABBREVS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ── priority bar colour ───────────────────────────────────────────────────
function barClassName(priority: MyWeekCard["priority"]): string {
  if (priority && priority in PRIORITY_TINT) {
    // extract the bg portion of the chip class (first token)
    const chipClass = PRIORITY_TINT[priority as CardPriority].chip;
    const bg = chipClass.split(" ").find((c) => c.startsWith("bg-")) ?? "";
    return bg;
  }
  return "";
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
      ? `${MONTH_ABBREVS[d.getUTCMonth()]} ${d.getUTCDate()}`
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
    <div data-testid="me-week-gantt" className="overflow-x-auto">
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
            const bgCls = barClassName(card.priority);

            const tooltip = [
              card.title,
              `${card.workspaceName} / ${card.boardTitle}`,
              `${formatDateShort(card.startDate)}→${formatDateShort(card.targetDate)}`,
            ].join(" · ");

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
                    "absolute flex items-center px-2 rounded text-[11px] font-medium overflow-hidden whitespace-nowrap cursor-pointer transition-opacity",
                    bgCls || "bg-[var(--surface-hi,oklch(0.25_0_0))]",
                    isDone ? "line-through opacity-50" : "opacity-90 hover:opacity-100",
                    "text-fg",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    left: leftPx,
                    width: widthPx,
                    height: 28,
                    zIndex: 1,
                  }}
                >
                  <span className="truncate">{card.title}</span>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
