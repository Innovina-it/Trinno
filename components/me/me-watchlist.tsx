"use client";

import Link from "next/link";
import type { WatchedCard } from "@/lib/queries/me-inbox";

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

interface MeWatchlistProps {
  cards: WatchedCard[];
}

export function MeWatchlist({ cards }: MeWatchlistProps) {
  return (
    <div data-testid="me-watchlist" className="flex flex-col gap-1">
      {/* Header */}
      <div className="mb-1 px-1">
        <span className="mono-meta-sm uppercase tracking-widest text-fg-faint">
          Watchlist
        </span>
      </div>

      {/* Empty state */}
      {cards.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-fg-faint/40">
          NOT WATCHING ANYTHING
        </p>
      )}

      {/* Card rows */}
      {cards.map((card) => {
        const completed = card.completedAt !== null;
        return (
          <Link
            key={card.id}
            href={`/b/${card.boardId}/c/${card.id}`}
            data-testid="me-watchlist-item"
            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
          >
            {/* Title */}
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                completed ? "text-fg-faint/60 line-through" : ""
              }`}
            >
              {card.title}
            </span>

            {/* Workspace.Board chip */}
            <span className="mono-meta-sm shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-fg-faint">
              {card.workspaceName}&thinsp;/&thinsp;{card.boardTitle}
            </span>

            {/* Last activity */}
            {card.lastActivityAt && (
              <span className="mono-meta-sm shrink-0 tabular-nums text-fg-faint/60">
                {relativeTime(card.lastActivityAt)}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
