import Link from "next/link";
import { formatDate as _fmtDate } from "@/lib/format-date";

function fmtDate(d: Date | string | null) { return _fmtDate(d) || null; }

export function GadgetAssignedToMe({
  rows,
}: {
  rows: Array<{
    id: string;
    title: string;
    boardId: string;
    dueDate: Date | string | null;
    type: string;
    boardTitle: string;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-fg-muted text-sm italic">Nothing assigned.</div>
    );
  }
  return (
    <ul
      className="space-y-1.5 overflow-y-auto max-h-full"
      data-testid="gadget-assigned-list"
    >
      {rows.map((r) => (
        <li
          key={r.id}
          className="text-sm flex items-baseline justify-between gap-2"
        >
          <Link
            href={`/b/${r.boardId}?card=${r.id}`}
            className="truncate hover:text-fg-muted transition-colors"
          >
            <span className="mono-meta-sm text-fg-faint mr-1.5">
              {r.type.toUpperCase()}
            </span>
            <span>{r.title}</span>
          </Link>
          <span className="mono-meta-sm text-fg-faint shrink-0 tabular-nums">
            {fmtDate(r.dueDate) ?? "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
