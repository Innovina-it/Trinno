"use client";
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
import type { FavoriteEntry, RecentEntry } from "@/components/nav/nav-types";
import { logout } from "@/actions/auth";

function deriveInitials(email: string): string {
  // Pull initials from the email's local-part. Prefer characters around `.`,
  // `-`, or `_`; fall back to the first two letters. No-op on empty string.
  const local = (email.split("@")[0] ?? "").trim();
  if (!local) return "??";
  const parts = local
    .split(/[._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

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
  void userId;
  const initials = deriveInitials(email);
  const favs = favorites.slice(0, 5);
  const recs = recents.slice(0, 5);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="size-8 shrink-0 rounded-full bg-[color:var(--surface-strong)] border border-[color:var(--hairline-hi)] text-[10px] font-semibold text-fg hover:bg-[color:var(--surface-hi)] transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
        aria-label={`Account (${email})`}
        title={email}
      >
        {initials}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 max-h-[80vh] overflow-y-auto"
      >
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
            <span>Inbox</span>
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
            className="w-full text-left px-2.5 py-2 text-sm text-fg-muted hover:text-fg hover:bg-[color:var(--surface-strong)] rounded-lg transition-colors flex items-center gap-2"
          >
            <LogOut className="size-3.5" />
            Log out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
