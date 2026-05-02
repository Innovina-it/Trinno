import Link from "next/link";
import { listActivityForBoard } from "@/lib/queries/activity";
import { getSessionToken } from "@/lib/auth";

function humanType(type: string): string {
  const map: Record<string, string> = {
    "list.create": "created list",
    "list.rename": "renamed list",
    "list.archive": "archived list",
    "list.unarchive": "restored list",
    "card.create": "created card",
    "card.rename": "renamed card",
    "card.description": "edited description",
    "card.move": "moved card",
    "card.archive": "archived card",
    "card.unarchive": "restored card",
    "card.due": "set due date",
    "card.dates": "set roadmap dates",
    "card.label.add": "added label",
    "card.label.remove": "removed label",
    "card.member.assign": "assigned member",
    "card.member.unassign": "unassigned member",
    "comment.create": "commented",
    "comment.edit": "edited comment",
    "comment.delete": "deleted comment",
    "board.member.add": "joined board",
    "board.member.remove": "left board",
  };
  return map[type] ?? type;
}

function rel(dateStr: string): string {
  const d = new Date(dateStr).getTime();
  const now = Date.now();
  const sec = Math.round((now - d) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export async function ActivityFeed({
  boardId,
  workspaceId,
}: {
  boardId: string;
  workspaceId: string;
}) {
  const token = (await getSessionToken())!;
  const rows = await listActivityForBoard(token, boardId, 30);
  return (
    <aside
      className="glass w-72 shrink-0 rounded-2xl text-fg max-h-[calc(100vh-9rem)] overflow-hidden flex flex-col"
      data-testid="activity-feed"
    >
      <div className="px-4 py-3 border-b border-hairline">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="serif-display text-lg text-fg leading-none">
            Activity
          </h2>
          <span className="mono-meta-sm text-fg-faint">LOG</span>
        </div>
        <p className="mono-meta-sm text-fg-faint mt-1">
          {rows.length} ENTRIES
        </p>
      </div>

      {rows.length === 0 && (
        <div className="px-4 py-8 text-center">
          <p className="serif-display text-2xl text-fg-muted">Nothing yet.</p>
          <p className="mono-meta-sm mt-2 text-fg-faint">
            Updates appear here in real time.
          </p>
        </div>
      )}

      <ul className="overflow-y-auto divide-y divide-hairline">
        {rows.map((r) => {
          const isRoadmapDates = r.type === "card.dates" && r.cardId;
          const body = (
            <>
              <div className="mono-meta-sm text-fg-faint">{humanType(r.type)}</div>
              <div className="text-sm leading-snug mt-0.5">
                <span className="font-medium text-fg">
                  {r.actorName ?? "Someone"}
                </span>
              </div>
              <div className="mono-meta-sm text-fg-faint mt-0.5">
                {rel(r.createdAt as unknown as string)}
              </div>
            </>
          );
          return (
            <li
              key={r.id}
              className="px-4 py-2.5 transition-colors duration-150 hover:bg-[rgb(255_255_255/0.04)]"
              data-testid={`activity-${r.type}`}
            >
              {isRoadmapDates ? (
                <Link
                  href={`/w/${workspaceId}/roadmap?focus=${r.cardId}`}
                  className="block"
                >
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
