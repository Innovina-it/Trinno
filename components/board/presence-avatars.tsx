"use client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Viewer } from "@/hooks/use-board-presence";

export function PresenceAvatars({ viewers }: { viewers: Viewer[] }) {
  if (viewers.length === 0) return null;
  return (
    <div className="flex -space-x-2">
      {viewers.slice(0, 5).map((v) => (
        <Avatar key={v.userId} className="size-7 ring-2 ring-white/40">
          <AvatarImage src={v.avatarUrl ?? undefined} />
          <AvatarFallback>{v.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {viewers.length > 5 && (
        <span className="ml-3 text-white/80 text-xs self-center">
          +{viewers.length - 5}
        </span>
      )}
    </div>
  );
}
