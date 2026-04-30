import Link from "next/link";
import { SprintPicker, type SprintLite } from "./sprint-picker";

export function BacklogList({
  cards,
  sprints,
}: {
  cards: Array<{
    id: string;
    title: string;
    boardId: string;
    boardTitle: string;
    sprintId: string | null;
  }>;
  sprints: SprintLite[];
}) {
  if (cards.length === 0) {
    return <p className="text-sm text-fg-faint italic">Backlog is empty.</p>;
  }
  // Group by board
  const groups = new Map<string, typeof cards>();
  for (const c of cards) {
    const arr = groups.get(c.boardId) ?? [];
    arr.push(c);
    groups.set(c.boardId, arr);
  }
  return (
    <div className="space-y-4">
      {Array.from(groups.values()).map((group) => (
        <div key={group[0].boardId} className="glass rounded-2xl">
          <header className="px-4 py-2 border-b border-hairline mono-meta text-fg">
            {group[0].boardTitle}
          </header>
          <ul className="divide-y divide-hairline">
            {group.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                <Link
                  href={`/b/${c.boardId}/c/${c.id}`}
                  className="flex-1 min-w-0 truncate hover:underline text-sm"
                >
                  {c.title}
                </Link>
                <SprintPicker
                  cardId={c.id}
                  sprintId={c.sprintId ?? null}
                  sprints={sprints}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
