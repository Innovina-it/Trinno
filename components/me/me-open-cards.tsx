"use client";

import Link from "next/link";
import { TypeIcon } from "@/components/board/card/type-picker";
import {
  PriorityChip,
  type CardPriority,
} from "@/components/board/card/priority-picker";
import type { MyCard } from "@/lib/queries/me-cards";
import { formatDate } from "@/lib/format-date";

export type { MyCard };

const PRIORITY_ORDER: Record<string, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
  p4: 4,
};

const COLUMNS: { key: string; label: string }[] = [
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Blocked" },
  { key: "other", label: "Other" },
];

function columnKey(statusKind: MyCard["statusKind"]): string {
  if (
    statusKind === null ||
    statusKind === "done" ||
    !["todo", "in_progress", "review", "blocked"].includes(statusKind)
  ) {
    return "other";
  }
  return statusKind;
}

function sortCards(cards: MyCard[]): MyCard[] {
  return [...cards].sort((a, b) => {
    const pa = a.priority !== null ? (PRIORITY_ORDER[a.priority] ?? 99) : 99;
    const pb = b.priority !== null ? (PRIORITY_ORDER[b.priority] ?? 99) : 99;
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
}

function isOverdue(card: MyCard): boolean {
  if (!card.dueDate || card.completedAt) return false;
  return new Date(card.dueDate) < new Date();
}

interface CardRowProps {
  card: MyCard;
}

function CardRow({ card }: CardRowProps) {
  const overdue = isOverdue(card);

  // Two-line layout — title gets full row width, meta lives below.
  // The previous one-line layout crushed the title to 0px in narrow
  // columns because the workspace/board chip is `shrink-0`.
  return (
    <Link
      href={`/b/${card.boardId}/c/${card.id}`}
      className="block min-w-0 rounded-lg px-2 py-1.5 hover:bg-white/5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <TypeIcon type={card.type} className="size-3.5 shrink-0 text-fg-faint" />
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          {card.title}
        </span>
        {card.priority && (
          <PriorityChip priority={card.priority as CardPriority} />
        )}
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-5 text-fg-faint">
        <span className="mono-meta-sm truncate">
          {card.workspaceName}&thinsp;/&thinsp;{card.boardTitle}
        </span>
        {card.dueDate && (
          <span
            className={`mono-meta-sm shrink-0 tabular-nums ${overdue ? "text-[color:var(--accent-magenta)]" : ""}`}
          >
            ·{" "}
            {formatDate(card.dueDate)}
          </span>
        )}
      </div>
    </Link>
  );
}

interface MeOpenCardsProps {
  cards: MyCard[];
}

export function MeOpenCards({ cards }: MeOpenCardsProps) {
  const grouped = new Map<string, MyCard[]>();
  for (const col of COLUMNS) {
    grouped.set(col.key, []);
  }
  for (const card of cards) {
    // milestone-as-card cards live in a hidden list and must never
    // surface on normal card surfaces like the open-cards board.
    if (card.type === "milestone") continue;
    const key = columnKey(card.statusKind);
    grouped.get(key)?.push(card);
  }

  return (
    <div
      data-testid="me-open-cards"
      className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5"
    >
      {COLUMNS.map((col) => {
        const colCards = sortCards(grouped.get(col.key) ?? []);
        return (
          <div
            key={col.key}
            data-testid="me-open-cards-column"
            data-status={col.key}
            className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/5 p-3"
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="mono-meta-sm uppercase tracking-widest text-fg-faint">
                {col.label}
              </span>
              <span className="mono-meta-sm tabular-nums text-fg-faint/60">
                {colCards.length}
              </span>
            </div>
            {colCards.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-fg-faint/40">
                —
              </p>
            ) : (
              colCards.map((card) => <CardRow key={card.id} card={card} />)
            )}
          </div>
        );
      })}
    </div>
  );
}
