"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  WorkspaceSwitcher,
  type WorkspaceLite,
} from "@/components/workspace/workspace-switcher";
import { SearchBox } from "@/components/nav/search-box";
import { AccountMenu } from "@/components/nav/account-menu";
import { NotificationBell } from "@/components/nav/notification-bell";
import type { FavoriteEntry, RecentEntry } from "@/components/nav/nav-types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Archive,
  Calendar,
  Columns,
  ListChecks,
  Map,
  Menu,
  Tag,
} from "lucide-react";

type WsLink = {
  href: string;
  label: string;
  Icon: typeof Map;
  testId: string;
};

export function TopNav({
  email,
  userId,
  workspaces,
  activeWorkspaceId,
  favorites,
  recents,
}: {
  email: string;
  userId: string;
  workspaces: WorkspaceLite[];
  activeWorkspaceId?: string;
  favorites: FavoriteEntry[];
  recents: RecentEntry[];
}) {
  const pathname = usePathname() ?? "";
  const wsForLinks = activeWorkspaceId ?? workspaces[0]?.id;
  const wsLinks: WsLink[] = wsForLinks
    ? [
        { href: `/w/${wsForLinks}/roadmap`, label: "Roadmap", Icon: Map, testId: "nav-roadmap" },
        { href: `/w/${wsForLinks}/boards`, label: "Boards", Icon: Columns, testId: "nav-boards" },
        { href: `/w/${wsForLinks}/backlog`, label: "Backlog", Icon: Tag, testId: "nav-backlog" },
        { href: `/w/${wsForLinks}/all-tasks`, label: "My tasks", Icon: ListChecks, testId: "nav-all-tasks" },
        { href: `/w/${wsForLinks}/versions`, label: "Versions", Icon: Calendar, testId: "nav-versions" },
        { href: `/w/${wsForLinks}/archive`, label: "Archive", Icon: Archive, testId: "nav-archive" },
      ]
    : [];

  function isActive(href: string): boolean {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* Skip-to-content for keyboard users (WCAG 2.4.1). */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-3 focus-visible:py-2 focus-visible:rounded-md focus-visible:bg-[color:var(--popover)] focus-visible:text-fg focus-visible:border focus-visible:border-hairline-hi focus-visible:outline-none"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-hairline bg-[color:var(--bg-1)]">
        <div className="relative mx-auto max-w-screen-2xl px-4 h-14 flex items-center gap-3">
          {/* LEFT: brand + workspace */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href={wsForLinks ? `/w/${wsForLinks}` : "/"}
              aria-label="Trinno home"
              className="flex items-center gap-2 group/brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 rounded-md"
            >
              {/* Tile shown on mobile only (wordmark replaces it ≥sm). */}
              <span
                aria-hidden
                className="sm:hidden relative flex size-7 items-center justify-center rounded-md border border-hairline-hi bg-[color:var(--surface-strong)] transition-colors group-hover/brand:bg-[color:var(--surface-hi)]"
              >
                <span className="size-1.5 rounded-full bg-fg" />
              </span>
              <span className="hidden sm:inline font-sans text-sm font-semibold tracking-tight text-fg">
                Trinno
              </span>
            </Link>
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeId={activeWorkspaceId}
            />
          </div>

          {/* MIDDLE: workspace nav (lg+). */}
          <nav className="hidden lg:flex items-center gap-0.5 ml-auto mr-2">
            {wsLinks.map((l) => {
              const active = isActive(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  data-testid={l.testId}
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 ${
                    active
                      ? "bg-fg/10 text-fg"
                      : "text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.05)]"
                  }`}
                >
                  <l.Icon className="size-3.5" />
                  <span>{l.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Compact (<lg) hamburger */}
          <div className="lg:hidden ml-auto">
            {wsForLinks && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex items-center justify-center size-8 rounded-md text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
                  aria-label="Workspace navigation"
                >
                  <Menu className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {wsLinks.map((l) => (
                    <DropdownMenuItem
                      key={l.href}
                      render={
                        <Link href={l.href} data-testid={l.testId} />
                      }
                    >
                      <l.Icon className="size-3.5" />
                      {l.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <span aria-hidden className="hidden lg:inline h-6 w-px bg-hairline" />

          {/* RIGHT: search + bell + avatar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="hidden md:block">
              <SearchBox />
            </div>
            <NotificationBell userId={userId} />
            <AccountMenu
              userId={userId}
              email={email}
              favorites={favorites}
              recents={recents}
            />
          </div>
        </div>
      </header>
    </>
  );
}
