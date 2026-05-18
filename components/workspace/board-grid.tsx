import Link from "next/link";
import { Layers3 } from "lucide-react";
import { boardCode } from "@/lib/format";
import { FavoriteToggle } from "./favorite-toggle";

export type BoardTile = {
  id: string;
  title: string;
  backgroundKind: string;
  backgroundValue: string;
  archived: boolean;
  // When non-null, this row is a sub-board: its parent is a regular board
  // in the same workspace. Used to render a SUB-BOARD chip on the tile so
  // users can tell sub-boards apart from top-level boards in the grid.
  parentBoardId?: string | null;
};

export function BoardGrid({
  boards,
  favoritedIds = [],
}: {
  boards: BoardTile[];
  favoritedIds?: string[];
}) {
  const visible = boards.filter((b) => !b.archived);
  const favSet = new Set(favoritedIds);

  if (visible.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-12 text-center space-y-2">
        <p className="mono-meta-sm text-fg-faint">NO BOARDS</p>
        <p className="text-sm text-fg-muted max-w-sm mx-auto">
          Use the New board button at the top to create one.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((b, i) => (
        <li key={b.id}>
          <Link
            href={`/b/${b.id}`}
            data-board-id={b.id}
            prefetch={false}
            className="group/board glass relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-2xl p-5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[color:var(--hairline-hi)] hover:bg-[rgb(255_255_255/0.06)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
          >
            {/* Top strip: index + ID badge + favorite star */}
            <div className="flex items-baseline justify-between gap-2">
              <span className="mono-meta-sm text-fg-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex items-center gap-1.5">
                {b.parentBoardId && (
                  <span
                    data-testid="board-tile-subboard"
                    title="Sub-board"
                    className="chip mono-meta-sm inline-flex items-center gap-1 text-fg-muted"
                  >
                    <Layers3 className="size-3" aria-hidden />
                    SUB-BOARD
                  </span>
                )}
                <FavoriteToggle
                  boardId={b.id}
                  initial={favSet.has(b.id)}
                  size="sm"
                />
                <span className="chip">#{boardCode(b.id)}</span>
              </div>
            </div>

            {/* Center: bold sans board title */}
            <h2 className="font-sans text-xl font-semibold tracking-tight text-fg leading-tight">
              <span className="relative inline-block">
                {b.title}
                <span
                  aria-hidden
                  className="absolute left-0 right-0 -bottom-1 h-px origin-left scale-x-0 bg-fg/70 transition-transform duration-300 ease-out group-hover/board:scale-x-100"
                />
              </span>
            </h2>

            {/* Bottom strip: subtle CTA */}
            <div className="flex items-end justify-end">
              <span className="mono-meta-sm text-fg-muted transition-transform duration-200 group-hover/board:translate-x-0.5">
                OPEN &rarr;
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
