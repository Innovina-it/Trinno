"use client";

import Link from "next/link";
import type { BlockingMyCard } from "@/lib/queries/me-inbox";

interface MeBlockedProps {
  rows: BlockingMyCard[];
}

export function MeBlocked({ rows }: MeBlockedProps) {
  // Group by myCardId, preserving first-seen order.
  const order: string[] = [];
  const groups = new Map<string, BlockingMyCard[]>();
  for (const row of rows) {
    if (!groups.has(row.myCardId)) {
      order.push(row.myCardId);
      groups.set(row.myCardId, []);
    }
    groups.get(row.myCardId)!.push(row);
  }

  return (
    <div data-testid="me-blocked" className="flex flex-col gap-2">
      {/* Header */}
      <div className="mb-1 px-1">
        <span className="mono-meta-sm uppercase tracking-widest text-fg-faint">
          Blocked
        </span>
      </div>

      {/* Empty state */}
      {rows.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-fg-faint/40">
          NOTHING BLOCKING YOU
        </p>
      )}

      {/* Groups */}
      {order.map((myCardId) => {
        const blockers = groups.get(myCardId)!;
        const { myCardTitle } = blockers[0];

        return (
          <div
            key={myCardId}
            data-testid="me-blocked-group"
            className="rounded-lg border border-white/10 bg-white/5 p-2"
          >
            {/* Group header — my card */}
            <p className="mb-1.5 truncate px-1 text-sm font-medium">
              {myCardTitle}
            </p>

            {/* Blocker sub-rows */}
            <div className="flex flex-col gap-0.5">
              {blockers.map((b) => {
                const resolved = b.blockerCompletedAt !== null;
                return (
                  <Link
                    key={b.blockerId}
                    href={`/b/${b.blockerBoardId}/c/${b.blockerId}`}
                    className={`flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white/5 ${
                      resolved ? "opacity-50" : ""
                    }`}
                  >
                    {/* Green check if resolved */}
                    {resolved ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="size-3.5 shrink-0 text-green-400"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <span className="size-3.5 shrink-0" />
                    )}

                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        resolved ? "line-through" : ""
                      }`}
                    >
                      {b.blockerTitle}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
