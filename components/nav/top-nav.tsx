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
import { LayoutDashboard, Inbox, Calendar, Map, Tag, Menu } from "lucide-react";

const linkCls =
  "mono-meta-sm tracking-[0.14em] text-fg-muted hover:text-fg transition-colors px-2.5 py-1.5 rounded hover:bg-[rgb(255_255_255/0.05)] inline-flex items-center gap-1.5";

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
        { href: `/w/${wsForLinks}/backlog`, label: "Backlog", Icon: Tag },
        { href: `/w/${wsForLinks}/roadmap`, label: "Roadmap", Icon: Map },
        { href: `/w/${wsForLinks}/versions`, label: "Versions", Icon: Calendar },
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-[color:rgb(15_8_42/0.55)] backdrop-blur-2xl">
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[color:rgb(139_92_246/0.06)] to-transparent" />
      <div className="relative mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-4">
        {/* LEFT: brand + workspace identity */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href={wsForLinks ? `/w/${wsForLinks}` : "/"}
            aria-label="Trinnovina home"
            className="flex items-center gap-2 group/brand"
          >
            <span aria-hidden className="relative flex size-7 items-center justify-center transition-transform group-hover/brand:scale-105">
              <span className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-cyan via-accent-magenta to-accent-violet opacity-90" />
              <span className="absolute inset-[3px] rounded-full bg-[color:var(--bg-deep)]" />
              <span className="relative size-1.5 rounded-full bg-gradient-to-br from-accent-cyan to-accent-magenta" />
            </span>
            <span className="mono-meta tracking-[0.18em] text-fg hidden sm:inline">
              TRINNOVIN<span className="gradient-text-static font-bold">A</span>
            </span>
          </Link>
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>

        {/* MIDDLE: workspace-scoped nav (lg+) */}
        <nav className="hidden lg:flex items-center gap-0.5 ml-auto mr-2">
          {wsLinks.map((l) => (
            <Link key={l.href} href={l.href} className={linkCls}>
              <l.Icon className="size-3.5" />
              <span>{l.label.toUpperCase()}</span>
            </Link>
          ))}
        </nav>

        {/* Compact (<lg): hamburger collapses workspace nav */}
        <div className="lg:hidden ml-auto">
          {wsForLinks && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="p-1.5 rounded text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors"
                aria-label="Workspace navigation"
              >
                <Menu className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {wsLinks.map((l) => (
                  <DropdownMenuItem key={l.href} render={<Link href={l.href} />}>
                    <l.Icon className="size-3.5" />
                    {l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <span aria-hidden className="hidden lg:inline h-6 w-px bg-hairline" />

        {/* RIGHT: personal cluster (search + dashboards/inbox + favorites/recents/bell + logout) */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="hidden md:block mr-1">
            <SearchBox />
          </div>
          <Link
            href="/dashboards"
            className={linkCls + " hidden md:inline-flex"}
            data-testid="nav-dashboards"
            aria-label="Dashboards"
          >
            <LayoutDashboard className="size-3.5" />
            <span className="hidden xl:inline">DASHBOARDS</span>
          </Link>
          <Link
            href="/inbox"
            className={linkCls + " hidden md:inline-flex"}
            data-testid="nav-inbox"
            aria-label="Inbox"
          >
            <Inbox className="size-3.5" />
            <span className="hidden xl:inline">INBOX</span>
          </Link>
          <FavoritesDropdown favorites={favorites} />
          <RecentDropdown recents={recents} />
          <NotificationBell userId={userId} />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="ml-1 p-1.5 rounded-full bg-gradient-to-br from-accent-cyan to-accent-magenta size-7 text-[10px] font-bold text-white shrink-0 hover:scale-105 transition-transform"
              aria-label={`Account (${email})`}
              title={email}
            >
              {email.slice(0, 2).toUpperCase()}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled className="text-fg-faint">
                <span className="mono-meta-sm truncate">{email}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/dashboards" />} className="md:hidden">
                <LayoutDashboard className="size-3.5" /> Dashboards
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/inbox" />} className="md:hidden">
                <Inbox className="size-3.5" /> Inbox
              </DropdownMenuItem>
              <DropdownMenuSeparator className="md:hidden" />
              <form action={logout}>
                <button
                  type="submit"
                  className="w-full text-left px-2.5 py-2 text-sm text-[color:var(--accent-magenta)] hover:bg-[rgb(255_43_214/0.08)] rounded-lg transition-colors"
                >
                  Log out
                </button>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
