"use client";

import Link from "next/link";
import type { InboxItem } from "@/lib/queries/me-inbox";

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

interface MeInboxProps {
  items: InboxItem[];
}

export function MeInbox({ items }: MeInboxProps) {
  return (
    <div data-testid="me-inbox" className="flex flex-col gap-1">
      {/* Header */}
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="mono-meta-sm uppercase tracking-widest text-fg-faint">
          Inbox
        </span>
        <Link
          href="/inbox"
          className="mono-meta-sm text-fg-faint/60 hover:text-accent-blue"
        >
          all →
        </Link>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-fg-faint/40">
          INBOX ZERO
        </p>
      )}

      {/* Notification rows */}
      {items.map((item) => {
        const unread = item.readAt === null;
        const hasLink = item.boardId && item.cardId;

        return (
          <div
            key={item.id}
            data-testid="me-inbox-item"
            data-unread={unread ? "true" : "false"}
            className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 ${
              unread ? "" : "opacity-50"
            }`}
          >
            {/* Unread dot */}
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: unread
                  ? "var(--accent-magenta)"
                  : "transparent",
                flexShrink: 0,
              }}
            />

            {/* Content */}
            <span className="min-w-0 flex-1 truncate text-sm">
              {item.actorName && (
                <span className="font-medium">{item.actorName} </span>
              )}
              <span className="text-fg-faint">{item.kind}</span>
              {item.cardTitle && (
                <>
                  {" "}
                  {hasLink ? (
                    <Link
                      href={`/b/${item.boardId}/c/${item.cardId}`}
                      className="hover:text-accent-blue"
                    >
                      {item.cardTitle}
                    </Link>
                  ) : (
                    <span>{item.cardTitle}</span>
                  )}
                </>
              )}
            </span>

            {/* Relative time */}
            <span className="mono-meta-sm shrink-0 tabular-nums text-fg-faint/60">
              {relativeTime(item.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
