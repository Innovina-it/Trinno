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
      className="w-72 shrink-0 border border-ink bg-paper text-ink max-h-[calc(100vh-9rem)] overflow-y-auto"
      data-testid="activity-feed"
    >
      <div className="border-b border-rule px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="serif-display text-xl text-ink leading-none">Activity</h2>
          <span className="mono-meta-sm text-ink/40">LOG</span>
        </div>
        <p className="mono-meta-sm text-ink/45 mt-1">{rows.length} ENTRIES</p>
      </div>

      {rows.length === 0 && (
        <div className="px-4 py-8 text-center">
          <p className="serif-display text-2xl text-ink/70 italic">
            &ldquo;Nothing yet.&rdquo;
          </p>
          <p className="mono-meta-sm mt-2 text-ink/40">
            Updates appear here in real time.
          </p>
        </div>
      )}

      <ul className="divide-y divide-[color:var(--rule)]">
        {rows.map((r) => (
          <li
            key={r.id}
            className="px-3 py-2 transition-colors duration-150 hover:bg-paper-shadow"
            data-testid={`activity-${r.type}`}
          >
            {/* Mono-uppercase visual via CSS only — text stays lowercase so
                substring tests like toContainText("created list") still match. */}
            <div className="mono-meta-sm text-ink/55">{humanType(r.type)}</div>
            <div className="text-sm leading-snug mt-0.5">
              <span className="font-medium text-ink">{r.actorName ?? "Someone"}</span>
            </div>
            <div className="mono-meta-sm text-ink/40 mt-0.5">
              {rel(r.createdAt as unknown as string)}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
