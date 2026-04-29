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

export async function ActivityFeed({ boardId }: { boardId: string }) {
  const token = (await getSessionToken())!;
  const rows = await listActivityForBoard(token, boardId, 30);
  return (
    <aside
      className="w-72 shrink-0 rounded-xl bg-black/35 p-3 text-white text-sm space-y-3 max-h-[calc(100vh-8rem)] overflow-y-auto ring-1 ring-white/10 backdrop-blur-sm shadow-sm"
      data-testid="activity-feed"
    >
      <h2 className="font-semibold tracking-tight">Activity</h2>
      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-4 text-center">
          <p className="text-xs text-white/70">No activity yet.</p>
          <p className="mt-0.5 text-[10px] text-white/40">Changes show up here in real time.</p>
        </div>
      )}
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li
            key={r.id}
            className="text-xs leading-relaxed rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-white/5"
            data-testid={`activity-${r.type}`}
          >
            <span className="font-medium">{r.actorName ?? "Someone"}</span>
            {" "}{humanType(r.type)}
            <div className="text-white/50">{rel(r.createdAt as unknown as string)}</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
