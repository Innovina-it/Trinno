import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export type BoardTile = {
  id: string; title: string;
  backgroundKind: string; backgroundValue: string;
  archived: boolean;
};

function tileBackground(b: BoardTile): string {
  const base = b.backgroundKind === "color" ? b.backgroundValue : "#0079bf";
  // Layer a soft top-left highlight + bottom-right shadow over the chosen color
  // so flat colors feel dimensional without needing any image asset.
  return `radial-gradient(circle at 0% 0%, rgba(255,255,255,0.28), transparent 55%), radial-gradient(circle at 100% 100%, rgba(0,0,0,0.22), transparent 55%), ${base}`;
}

export function BoardGrid({ boards }: { boards: BoardTile[] }) {
  const visible = boards.filter(b => !b.archived);
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGrid />}
        title="No boards yet"
        description="Boards keep your projects, tasks, and lists organized. Create your first one to get started."
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {visible.map(b => (
        <li key={b.id}>
          <Link
            href={`/b/${b.id}`}
            className="group/board relative block aspect-[3/2] overflow-hidden rounded-xl p-3 text-white font-semibold tracking-tight shadow-sm ring-1 ring-black/5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:ring-black/10"
            style={{ background: tileBackground(b) }}
          >
            <span className="relative z-10 drop-shadow-sm">{b.title}</span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/0 to-white/15 opacity-0 transition-opacity duration-200 group-hover/board:opacity-100"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
