"use client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Viewer } from "@/hooks/use-board-presence";

export function PresenceAvatars({ viewers }: { viewers: Viewer[] }) {
  if (viewers.length === 0) return null;
  return (
    <div className="flex -space-x-1 items-center">
      {viewers.slice(0, 5).map((v) => (
        <Avatar
          key={v.userId}
          className="size-7 rounded-none border border-ink bg-paper-shadow ring-2 ring-paper"
        >
          <AvatarImage src={v.avatarUrl ?? undefined} className="rounded-none" />
          <AvatarFallback className="rounded-none bg-ink text-paper text-[10px] tracking-widest">
            {v.displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {viewers.length > 5 && (
        <span className="ml-2 mono-meta-sm text-ink/60 self-center">
          +{viewers.length - 5}
        </span>
      )}
    </div>
  );
}
