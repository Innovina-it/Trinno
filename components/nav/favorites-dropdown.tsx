"use client";
import Link from "next/link";
import { Star } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type FavoriteEntry = {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceName: string;
};

/**
 * Plan #16b-γ-C (#4) — client dropdown that renders the favorites list
 * fetched server-side by the layout. Splitting into a presentational
 * client component lets us keep the surrounding TopNav as a Server
 * Component while still using base-ui's client-only Menu primitives.
 */
export function FavoritesDropdown({
  favorites,
}: {
  favorites: FavoriteEntry[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="mono-meta-sm tracking-[0.18em] text-fg-muted hover:text-fg transition-colors inline-flex items-center gap-1"
        data-testid="nav-favorites"
      >
        <Star className="size-3" />
        FAVORITES
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        {favorites.length === 0 ? (
          <div className="px-3 py-2 mono-meta-sm text-fg-faint">
            No favorites yet.
          </div>
        ) : (
          <ul className="py-1">
            {favorites.map((f) => (
              <li key={f.boardId}>
                <Link
                  href={`/b/${f.boardId}`}
                  className="block px-3 py-2 hover:bg-[rgb(255_255_255/0.06)] transition-colors"
                  data-testid="nav-favorite-item"
                  data-board-id={f.boardId}
                >
                  <div className="text-sm text-fg truncate">{f.boardTitle}</div>
                  <div className="mono-meta-sm text-fg-faint truncate">
                    {f.workspaceName}
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
