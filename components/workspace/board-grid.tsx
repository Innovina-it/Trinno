import Link from "next/link";

export type BoardTile = {
  id: string; title: string;
  backgroundKind: string; backgroundValue: string;
  archived: boolean;
};

export function BoardGrid({ boards }: { boards: BoardTile[] }) {
  const visible = boards.filter(b => !b.archived);
  if (visible.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No boards yet. Create one with the button above.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {visible.map(b => (
        <li key={b.id}>
          <Link
            href={`/b/${b.id}`}
            className="block aspect-[3/2] rounded-md p-3 text-white font-medium shadow-sm hover:opacity-90 transition"
            style={{ background: b.backgroundKind === "color" ? b.backgroundValue : undefined }}
          >
            {b.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
