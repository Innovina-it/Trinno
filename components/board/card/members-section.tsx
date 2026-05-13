"use client";
import { useTransition } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { toggleCardMember } from "@/actions/card-members";
import { toast } from "sonner";
import { undoBus } from "@/lib/undo-bus";

export function MembersSection({ cardId }: { cardId: string }) {
  const boardProfiles = useBoardStore((s) => s.boardProfiles);
  const workspaceProfiles = useBoardStore((s) => s.workspaceProfiles);
  const cardMembers = useBoardStore((s) => s.cardMembers);
  const addCardMember = useBoardStore((s) => s.addCardMember);
  const removeCardMember = useBoardStore((s) => s.removeCardMember);
  const upsertBoardMember = useBoardStore((s) => s.upsertBoardMember);
  const [pending, start] = useTransition();

  const boardMemberIds = new Set(boardProfiles.map((p) => p.id));
  const assigned = new Set(
    cardMembers.filter((m) => m.cardId === cardId).map((m) => m.userId),
  );

  // Show board members first, then any remaining workspace members.
  // Assigning a workspace-only person promotes them to board_member
  // server-side (trigger 0098). We optimistically mirror that locally so
  // the avatar bar and member roster update without waiting for a snapshot
  // refetch.
  const all = [
    ...boardProfiles,
    ...workspaceProfiles.filter((p) => !boardMemberIds.has(p.id)),
  ];

  function toggle(userId: string) {
    const wasAssigned = assigned.has(userId);
    const profile = all.find((p) => p.id === userId);
    const memberName = profile?.displayName ?? "Member";
    const willPromoteToBoard = !wasAssigned && !boardMemberIds.has(userId);

    if (wasAssigned) removeCardMember(cardId, userId);
    else {
      addCardMember({ cardId, userId });
      if (willPromoteToBoard && profile) {
        upsertBoardMember({ userId, role: "member" }, profile);
      }
    }
    start(async () => {
      try {
        await toggleCardMember({ cardId, userId });
        undoBus.push({
          message: wasAssigned
            ? `Unassigned ${memberName}`
            : `Assigned ${memberName}`,
          undo: async () => {
            if (wasAssigned) addCardMember({ cardId, userId });
            else removeCardMember(cardId, userId);
            try {
              await toggleCardMember({ cardId, userId });
            } catch (err) {
              if (wasAssigned) removeCardMember(cardId, userId);
              else addCardMember({ cardId, userId });
              toast.error("Undo failed: " + (err as Error).message);
            }
          },
        });
      } catch (err) {
        if (wasAssigned) addCardMember({ cardId, userId });
        else removeCardMember(cardId, userId);
        toast.error((err as Error).message);
      }
    });
  }

  if (all.length === 0) return null;
  return (
    <section className="space-y-3" data-testid="members-section">
      <div className="flex items-baseline justify-between border-b border-hairline pb-1">
        <h3 className="mono-meta text-fg-muted">Members</h3>
      </div>
      <p className="text-xs leading-snug text-fg-muted">
        Collaborators helping with the work. Assigning a workspace member
        adds them to this board automatically.
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {all.map((p) => {
          const on = assigned.has(p.id);
          const notOnBoard = !boardMemberIds.has(p.id);
          return (
            <li key={p.id}>
              <Button
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                disabled={pending}
                onClick={() => toggle(p.id)}
                data-user-id={p.id}
                data-assigned={on}
                data-not-board-member={notOnBoard ? "true" : undefined}
                title={notOnBoard ? "From workspace — assigning will add to board" : undefined}
                className={
                  "gap-1.5 normal-case tracking-normal" +
                  (notOnBoard && !on ? " border-dashed text-fg-muted" : "")
                }
              >
                <Avatar size="sm" className="rounded-none border border-current">
                  <AvatarFallback className="rounded-none bg-transparent text-current text-[10px] tracking-widest">
                    {p.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs">{p.displayName}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
