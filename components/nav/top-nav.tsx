import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";
import { WorkspaceSwitcher, type WorkspaceLite } from "@/components/workspace/workspace-switcher";
import { SearchBox } from "@/components/nav/search-box";
import { NotificationBell } from "@/components/nav/notification-bell";
import { FavoritesDropdown, type FavoriteEntry } from "@/components/nav/favorites-dropdown";
import { RecentDropdown, type RecentEntry } from "@/components/nav/recent-dropdown";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LogOut, Menu } from "lucide-react";

const linkCls =
  "mono-meta-sm tracking-[0.14em] text-fg-muted hover:text-fg transition-colors px-2 py-1 rounded hover:bg-[rgb(255_255_255/0.04)]";

export function TopNav({
  email, userId, workspaces, activeWorkspaceId, favorites, recents,
}: {
  email: string;
  userId: string;
  workspaces: WorkspaceLite[];
  activeWorkspaceId?: string;
  favorites: FavoriteEntry[];
  recents: RecentEntry[];
}) {
  const wsForLinks = activeWorkspaceId ?? workspaces[0]?.id;
  const wsLinks = wsForLinks
    ? [
        { href: `/w/${wsForLinks}/backlog`, label: "BACKLOG" },
        { href: `/w/${wsForLinks}/roadmap`, label: "ROADMAP" },
        { href: `/w/${wsForLinks}/versions`, label: "VERSIONS" },
      ]
    : [];
  const globalLinks = [
    { href: "/dashboards", label: "DASHBOARDS", testId: "nav-dashboards" },
    { href: "/inbox", label: "INBOX", testId: "nav-inbox" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-[color:rgb(15_8_42/0.55)] backdrop-blur-2xl">
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[color:rgb(139_92_246/0.06)] to-transparent" />
      <div className="relative mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-3">
        {/* Brand + workspace */}
        <div className="flex items-center gap-2 shrink-0">
          <span aria-hidden className="relative flex size-7 items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-cyan via-accent-magenta to-accent-violet opacity-90" />
            <span className="absolute inset-[3px] rounded-full bg-[color:var(--bg-deep)]" />
            <span className="relative size-1.5 rounded-full bg-gradient-to-br from-accent-cyan to-accent-magenta" />
          </span>
          <Link
            href={wsForLinks ? `/w/${wsForLinks}` : "/"}
            aria-label="Trello Clone"
            className="mono-meta tracking-[0.18em] text-fg transition-opacity hover:opacity-80 hidden sm:inline"
          >
            TRINNOVIN<span className="gradient-text-static font-bold">A</span>
          </Link>
          <span className="text-fg-faint select-none ml-1 hidden sm:inline" aria-hidden>/</span>
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>

        {/* Primary nav (lg+ only) */}
        <nav className="hidden lg:flex items-center gap-1 ml-2 min-w-0 flex-1">
          {wsLinks.map((l) => (
            <Link key={l.href} href={l.href} className={linkCls}>
              {l.label}
            </Link>
          ))}
          {wsLinks.length > 0 && globalLinks.length > 0 && (
            <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
          )}
          {globalLinks.map((l) => (
            <Link key={l.href} href={l.href} className={linkCls} data-testid={l.testId}>
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Compact nav (md and below) — hamburger */}
        <div className="lg:hidden flex-1 flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors"
              aria-label="Open navigation"
            >
              <Menu className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {wsLinks.map((l) => (
                <DropdownMenuItem key={l.href} render={<Link href={l.href} />}>
                  {l.label}
                </DropdownMenuItem>
              ))}
              {wsLinks.length > 0 && globalLinks.length > 0 && <DropdownMenuSeparator />}
              {globalLinks.map((l) => (
                <DropdownMenuItem key={l.href} render={<Link href={l.href} />}>
                  {l.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right cluster: search + favorites + recents + bell + logout */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="hidden md:block">
            <SearchBox />
          </div>
          <FavoritesDropdown favorites={favorites} />
          <RecentDropdown recents={recents} />
          <NotificationBell userId={userId} />
          <form action={logout}>
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              aria-label={`Log out (${email})`}
              title={email}
            >
              <LogOut className="size-3.5" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
