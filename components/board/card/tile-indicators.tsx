"use client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useBoardStore } from "@/stores/board-store";
import { CheckSquare, Paperclip, MessageSquare } from "lucide-react";

export function TileIndicators({ cardId }: { cardId: string }) {
  const profiles = useBoardStore((s) => s.boardProfiles);
  const cardMembers = useBoardStore((s) => s.cardMembers);
  const checklists = useBoardStore((s) => s.checklists);
  const checklistItems = useBoardStore((s) => s.checklistItems);
  const attachments = useBoardStore((s) => s.attachments);
  const comments = useBoardStore((s) => s.comments);

  const memberIds = cardMembers
    .filter((cm) => cm.cardId === cardId)
    .map((cm) => cm.userId);
  const memberProfiles = memberIds
    .map((uid) => profiles.find((p) => p.id === uid))
    .filter((p): p is { id: string; displayName: string } => Boolean(p));

  const myChecklistIds = new Set(
    checklists.filter((c) => c.cardId === cardId).map((c) => c.id),
  );
  const myItems = checklistItems.filter((i) => myChecklistIds.has(i.checklistId));
  const itemDone = myItems.filter((i) => i.completed).length;
  const itemTotal = myItems.length;

  const attachmentCount = attachments.filter((a) => a.cardId === cardId).length;
  const commentCount = comments.filter((c) => c.cardId === cardId).length;

  const hasAny =
    memberProfiles.length > 0 ||
    itemTotal > 0 ||
    attachmentCount > 0 ||
    commentCount > 0;
  if (!hasAny) return null;

  return (
    <div className="mt-1 flex items-center justify-between gap-2 mono-meta-sm text-ink/55">
      <div className="flex items-center gap-2.5">
        {itemTotal > 0 && (
          <span
            className={`inline-flex items-center gap-1 ${itemDone === itemTotal ? "text-moss" : ""}`}
            data-testid="tile-checklist"
          >
            <CheckSquare className="size-3" />
            <span className="tabular-nums">
              {itemDone}/{itemTotal}
            </span>
          </span>
        )}
        {commentCount > 0 && (
          <span className="inline-flex items-center gap-1" data-testid="tile-comments">
            <MessageSquare className="size-3" />
            <span className="tabular-nums">{commentCount}</span>
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1" data-testid="tile-attachments">
            <Paperclip className="size-3" />
            <span className="tabular-nums">{attachmentCount}</span>
          </span>
        )}
      </div>
      {memberProfiles.length > 0 && (
        <div className="flex -space-x-1" data-testid="tile-members">
          {memberProfiles.slice(0, 3).map((p) => (
            <Avatar key={p.id} className="size-5 ring-2 ring-paper rounded-none">
              <AvatarFallback className="rounded-none bg-ink text-paper text-[9px] tracking-widest">
                {p.displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ))}
          {memberProfiles.length > 3 && (
            <span className="ml-1.5 self-center mono-meta-sm">+{memberProfiles.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}
