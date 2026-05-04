"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard, Inbox, Star, History, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import type { FavoriteEntry } from "@/components/nav/favorites-dropdown";
import type { RecentEntry } from "@/components/nav/recent-dropdown";
import { logout } from "@/actions/auth";

export function AccountMenu({
  userId,
  email,
  favorites,
  recents,
}: {
  userId: string;
  email: string;
  favorites: FavoriteEntry[];
  recents: RecentEntry[];
}) {
  const [unread, setUnread] = useState(0);

  // Live unread badge — same subscription pattern as the standalone bell.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await fetch("/api/notifications/recent", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const data = await r.json();
        setUnread(data.unread ?? 0);
      } catch {}
    }
    refresh();

    const supa = createSupabaseBrowser();
    const channel = supa
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_user_id=eq.${userId}`,
        },
        () => setUnread((u) => u + 1),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supa.removeChannel(channel);
    };
  }, [userId]);

  const initials = email.slice(0, 2).toUpperCase();
  const favs = favorites.slice(0, 5);
  const recs = recents.slice(0, 5);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative ml-1 size-8 shrink-0 rounded-full bg-gradient-to-br from-accent-cyan to-accent-magenta text-[10px] font-bold text-white hover:scale-105 transition-transform flex items-center justify-center"
        aria-label={`Account (${email})`}
        title={email}
      >
        {initials}
        {unread > 0 && (
          <span
            aria-label={`${unread} unread notifications`}
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[color:var(--accent-magenta)] text-[9px] flex items-center justify-center ring-2 ring-[color:var(--bg-deep)] tabular-nums"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-h-[80vh] overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="flex flex-col gap-0.5">
              <span className="mono-meta-sm text-fg-faint">SIGNED IN</span>
              <span className="text-sm truncate">{email}</span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/inbox" />}>
            <Inbox className="size-3.5" />
            <span className="flex-1">Inbox</span>
            {unread > 0 && (
              <span className="mono-meta-sm bg-[color:var(--accent-magenta)] text-white px-1.5 py-0.5 rounded tabular-nums">
                {unread}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/dashboards" />}>
            <LayoutDashboard className="size-3.5" />
            <span>Dashboards</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="mono-meta-sm text-fg-faint inline-flex items-center gap-1.5">
              <Star className="size-3" /> FAVORITES
            </span>
          </DropdownMenuLabel>
          {favs.length === 0 ? (
            <div className="px-2.5 py-1.5 text-xs text-fg-faint">
              Star a board to pin it here.
            </div>
          ) : (
            favs.map((f) => (
              <DropdownMenuItem
                key={f.boardId}
                render={<Link href={`/b/${f.boardId}`} />}
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-sm truncate">{f.boardTitle}</span>
                  <span className="mono-meta-sm text-fg-faint truncate">
                    {f.workspaceName}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="mono-meta-sm text-fg-faint inline-flex items-center gap-1.5">
              <History className="size-3" /> RECENT
            </span>
          </DropdownMenuLabel>
          {recs.length === 0 ? (
            <div className="px-2.5 py-1.5 text-xs text-fg-faint">
              Boards you visit appear here.
            </div>
          ) : (
            recs.map((r) => (
              <DropdownMenuItem
                key={r.boardId}
                render={<Link href={`/b/${r.boardId}`} />}
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-sm truncate">{r.boardTitle}</span>
                  <span className="mono-meta-sm text-fg-faint truncate">
                    {r.workspaceName}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <form action={logout}>
          <button
            type="submit"
            className="w-full text-left px-2.5 py-2 text-sm text-[color:var(--accent-magenta)] hover:bg-[rgb(255_43_214/0.08)] rounded-lg transition-colors flex items-center gap-2"
          >
            <LogOut className="size-3.5" />
            Log out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
