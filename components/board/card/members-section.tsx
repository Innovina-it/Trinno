"use client";
import { useTransition } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/stores/board-store";
import { toggleCardMember } from "@/actions/card-members";
import { toast } from "sonner";

export function MembersSection({ cardId }: { cardId: string }) {
  const profiles = useBoardStore((s) => s.boardProfiles);
  const cardMembers = useBoardStore((s) => s.cardMembers);
  const addCardMember = useBoardStore((s) => s.addCardMember);
  const removeCardMember = useBoardStore((s) => s.removeCardMember);
  const [pending, start] = useTransition();

  const assigned = new Set(
    cardMembers.filter((m) => m.cardId === cardId).map((m) => m.userId),
  );

  function toggle(userId: string) {
    const wasAssigned = assigned.has(userId);
    if (wasAssigned) removeCardMember(cardId, userId);
    else addCardMember({ cardId, userId });
    start(async () => {
      try {
        await toggleCardMember({ cardId, userId });
      } catch (err) {
        if (wasAssigned) addCardMember({ cardId, userId });
        else removeCardMember(cardId, userId);
        toast.error((err as Error).message);
      }
    });
  }

  if (profiles.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="members-section">
      <h3 className="text-sm font-semibold">Members</h3>
      <ul className="flex flex-wrap gap-2">
        {profiles.map((p) => {
          const on = assigned.has(p.id);
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
                className="gap-2"
              >
                <Avatar size="sm">
                  <AvatarFallback>
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
