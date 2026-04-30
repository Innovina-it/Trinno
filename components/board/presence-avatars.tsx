"use client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Viewer } from "@/hooks/use-board-presence";

export function PresenceAvatars({ viewers }: { viewers: Viewer[] }) {
  if (viewers.length === 0) return null;
  return (
    <div className="flex -space-x-1.5 items-center">
      {viewers.slice(0, 5).map((v) => (
        <Avatar
          key={v.userId}
          className="size-7 rounded-full border border-hairline-hi bg-surface-strong ring-2 ring-bg-deep"
        >
          <AvatarImage src={v.avatarUrl ?? undefined} className="rounded-full" />
          <AvatarFallback className="rounded-full bg-fg/10 text-fg text-[10px] font-semibold tracking-wider">
            {v.displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {viewers.length > 5 && (
        <span className="ml-2 mono-meta-sm text-fg-muted self-center">
          +{viewers.length - 5}
        </span>
      )}
    </div>
  );
}
