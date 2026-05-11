"use client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Viewer } from "@/hooks/use-board-presence";

export function PresenceAvatars({ viewers }: { viewers: Viewer[] }) {
  if (viewers.length === 0) return null;
  const cardViewers = viewers.filter((v) => v.location === "card");
  const summary =
    cardViewers.length > 0
      ? `${cardViewers.length} viewing cards`
      : `${viewers.length} on board`;
  return (
    <div className="flex items-center gap-2" title={summary}>
      <div className="flex -space-x-1.5 items-center">
        {viewers.slice(0, 3).map((v) => (
          <Avatar
            key={v.userId}
            title={
              v.location === "card" && v.cardTitle
                ? `${v.displayName} is viewing ${v.cardTitle}`
                : `${v.displayName} is on this board`
            }
            className={`size-7 rounded-full border bg-surface-strong ring-2 ring-bg-deep ${
              v.location === "card"
                ? "border-[color:var(--accent-cyan)]"
                : "border-hairline-hi"
            }`}
          >
            <AvatarImage src={v.avatarUrl ?? undefined} className="rounded-full" />
            <AvatarFallback className="rounded-full bg-fg/10 text-fg text-[10px] font-semibold tracking-wider">
              {v.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
        {viewers.slice(3, 5).map((v) => (
          <Avatar
            key={v.userId}
            title={
              v.location === "card" && v.cardTitle
                ? `${v.displayName} is viewing ${v.cardTitle}`
                : `${v.displayName} is on this board`
            }
            className={`hidden sm:inline-flex size-7 rounded-full border bg-surface-strong ring-2 ring-bg-deep ${
              v.location === "card"
                ? "border-[color:var(--accent-cyan)]"
                : "border-hairline-hi"
            }`}
          >
            <AvatarImage src={v.avatarUrl ?? undefined} className="rounded-full" />
            <AvatarFallback className="rounded-full bg-fg/10 text-fg text-[10px] font-semibold tracking-wider">
              {v.displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
        {viewers.length > 3 && (
          <span className="ml-2 mono-meta-sm text-fg-muted self-center sm:hidden">
            +{viewers.length - 3}
          </span>
        )}
        {viewers.length > 5 && (
          <span className="ml-2 mono-meta-sm text-fg-muted self-center hidden sm:inline">
            +{viewers.length - 5}
          </span>
        )}
      </div>
      {viewers.length > 0 && (
        <span className="hidden xl:inline mono-meta-sm text-fg-muted max-w-40 truncate">
          {summary}
        </span>
      )}
    </div>
  );
}
