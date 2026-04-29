import { listActivityForCard } from "@/lib/queries/activity";
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

export async function CardActivity({ cardId }: { cardId: string }) {
  const token = (await getSessionToken())!;
  const rows = await listActivityForCard(token, cardId, 30);
  return (
    <div className="space-y-2" data-testid="card-activity">
      <h3 className="font-medium">Activity</h3>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
      <ul className="space-y-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="font-medium">{r.actorName ?? "Someone"}</span>{" "}
            {humanType(r.type)}{" "}
            <span className="text-muted-foreground">{rel(r.createdAt as unknown as string)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
