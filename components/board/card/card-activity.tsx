import Link from "next/link";
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

export async function CardActivity({
  cardId,
  workspaceId,
}: {
  cardId: string;
  workspaceId?: string;
}) {
  const token = (await getSessionToken())!;
  const rows = await listActivityForCard(token, cardId, 30);
  return (
    <div className="space-y-3" data-testid="card-activity">
      <div className="flex items-baseline justify-between border-b border-rule pb-1">
        <h3 className="mono-meta text-ink/70">Activity</h3>
        <span className="mono-meta-sm text-ink/35">LOG</span>
      </div>
      {rows.length === 0 && (
        <p className="font-serif italic text-sm text-ink/50">No activity yet.</p>
      )}
      <ul className="divide-y divide-[color:var(--rule)]">
        {rows.map((r) => {
          const isRoadmapDates = r.type === "card.dates" && workspaceId;
          const body = (
            <>
              <div className="mono-meta-sm text-ink/55">{humanType(r.type)}</div>
              <div className="text-xs text-ink leading-snug mt-0.5">
                <span className="font-medium">{r.actorName ?? "Someone"}</span>
                <span className="ml-2 mono-meta-sm text-ink/45">
                  {rel(r.createdAt as unknown as string)}
                </span>
              </div>
            </>
          );
          return (
            <li key={r.id} className="py-1.5">
              {isRoadmapDates ? (
                <Link
                  href={`/w/${workspaceId}/roadmap?focus=${cardId}`}
                  className="block hover:bg-[rgb(0_0_0/0.03)] -mx-1 px-1 rounded"
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
    </div>
  );
}
