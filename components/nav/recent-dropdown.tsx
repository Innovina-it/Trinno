"use client";
import Link from "next/link";
import { History } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type RecentEntry = {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
};

/**
 * Plan #16b-γ-C (#5) — client dropdown showing the user's last 5
 * boards. Workspace label appears under each title so identically
 * named boards across workspaces stay distinguishable. Empty state
 * tells the user where the list comes from.
 */
export function RecentDropdown({ recents }: { recents: RecentEntry[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="mono-meta-sm tracking-[0.18em] text-fg-muted hover:text-fg transition-colors inline-flex items-center gap-1"
        data-testid="nav-recent"
      >
        <History className="size-3" />
        RECENT
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        {recents.length === 0 ? (
          <div className="px-3 py-2 mono-meta-sm text-fg-faint">
            Visited boards will appear here.
          </div>
        ) : (
          <ul className="py-1">
            {recents.map((r) => (
              <li key={r.boardId}>
                <Link
                  href={`/b/${r.boardId}`}
                  className="block px-3 py-2 hover:bg-[rgb(255_255_255/0.06)] transition-colors"
                  data-testid="nav-recent-item"
                  data-board-id={r.boardId}
                >
                  <div className="text-sm text-fg truncate">{r.boardTitle}</div>
                  <div className="mono-meta-sm text-fg-faint truncate">
                    {r.workspaceName}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
