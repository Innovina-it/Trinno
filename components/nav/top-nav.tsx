"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useWorkspaceMembershipSync } from "@/hooks/use-workspace-membership-sync";
import {
  WorkspaceSwitcher,
  type WorkspaceLite,
} from "@/components/workspace/workspace-switcher";
import { AccountMenu } from "@/components/nav/account-menu";
import { NotificationBell } from "@/components/nav/notification-bell";
import { MobileNavDrawer } from "@/components/nav/mobile-nav-drawer";
import { SidebarCollapseToggle } from "@/components/nav/sidebar-collapse-toggle";
import { useNavChords } from "@/lib/use-nav-chords";
import { openCommandPalette } from "@/lib/use-command-palette";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Archive,
  Calendar,
  ChevronDown,
  Columns,
  Home,
  LineChart,
  Map,
  Menu,
  MoreHorizontal,
  Search,
  Tag,
  Users,
} from "lucide-react";

type Primary = {
  href: string;
  label: string;
  Icon: typeof Map;
  testId: string;
  chord: string;
};

type Secondary = {
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
  activeWorkspaceLink,
  canEditWorkspaceLink,
  canImportPlan,
}: {
  email: string;
  userId: string;
  workspaces: WorkspaceLite[];
  activeWorkspaceId?: string;
  activeWorkspaceLink?: { url: string } | null;
  canEditWorkspaceLink?: boolean;
  canImportPlan?: boolean;
}) {
  const pathname = usePathname() ?? "";
  useWorkspaceMembershipSync(userId);
  useNavChords({ workspaceId: activeWorkspaceId ?? null });
  // base-ui's <DropdownMenu> generates ids via React.useId(); under React
  // 19 + Next.js 15 SSR those ids desync between server and client and
  // log a hydration mismatch. Defer dropdown rendering until after the
  // first client paint to skip the SSR pass for those subtrees.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const wsForLinks = activeWorkspaceId ?? workspaces[0]?.id;

  // Five primaries — destinations a user touches in the same session.
  // "Home" is always first; it's the cross-workspace personal dashboard
  // and never depends on `wsForLinks`.
  const primary: Primary[] = [
    { href: `/me`, label: "Home", Icon: Home, testId: "nav-home", chord: "g h" },
    ...(wsForLinks
      ? ([
          { href: `/w/${wsForLinks}/roadmap`, label: "Roadmap", Icon: Map, testId: "nav-roadmap", chord: "g r" },
          { href: `/w/${wsForLinks}/boards`, label: "Boards", Icon: Columns, testId: "nav-boards", chord: "g b" },
          { href: `/w/${wsForLinks}/backlog`, label: "Backlog", Icon: Tag, testId: "nav-backlog", chord: "g l" },
        ] as Primary[])
      : []),
  ];

  // Secondaries live in More so the bar stays uncluttered. Workload sits
  // here too because it's cross-workspace and shouldn't masquerade as a
  // workspace-scoped link.
  const secondary: Secondary[] = wsForLinks
    ? [
        { href: `/workload`, label: "Workload", Icon: Users, testId: "nav-workload" },
        { href: `/w/${wsForLinks}/versions`, label: "Versions", Icon: Calendar, testId: "nav-versions" },
        { href: `/w/${wsForLinks}/analysis`, label: "Analysis", Icon: LineChart, testId: "nav-analysis" },
        { href: `/w/${wsForLinks}/archive`, label: "Archive", Icon: Archive, testId: "nav-archive" },
      ]
    : [];

  function isActive(href: string): boolean {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + "/");
  }

  const moreActive = secondary.some((s) => isActive(s.href));
  const [drawerOpen, setDrawerOpen] = useState(false);

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
          {/* LEFT — brand + workspace */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href={wsForLinks ? `/w/${wsForLinks}` : "/"}
              aria-label="Trinno home"
              className="flex items-center gap-2 group/brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 rounded-md px-1 py-0.5"
            >
              {/* Mono "tn." monogram doubles as logo. The dot anchors it. */}
              <span
                aria-hidden
                className="mono-meta tracking-[0.04em] text-fg leading-none"
              >
                tn<span className="text-fg-faint">.</span>
              </span>
              {/* Resend-style wordmark: editorial serif (Instrument Serif,
                  already loaded as --font-instrument) with a white→grey
                  top-to-bottom gradient via bg-clip-text. Intentionally
                  overrides DESIGN.md's no-gradient-text rule for the brand
                  mark only, per product request. */}
              <span className="hidden sm:inline font-[family-name:var(--font-instrument)] text-lg leading-none tracking-tight bg-[linear-gradient(180deg,#ffffff_0%,#8f8f8f_100%)] bg-clip-text text-transparent">
                Trinno
              </span>
            </Link>
            <span aria-hidden className="hidden sm:inline h-5 w-px bg-hairline" />
            {mounted && (
              <WorkspaceSwitcher
                workspaces={workspaces}
                activeId={activeWorkspaceId}
                activeWorkspaceLink={activeWorkspaceLink}
                canEditWorkspaceLink={canEditWorkspaceLink}
              />
            )}
          </div>

          {/* CENTER — primary nav (lg+) */}
          <nav
            className="hidden lg:flex items-stretch h-full ml-auto mr-2"
            aria-label="Primary"
          >
            {primary.map((l) => {
              const active = isActive(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  data-testid={l.testId}
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  title={`${l.label} · ${l.chord}`}
                  className={`group/nav relative inline-flex items-center gap-1.5 h-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg/40 ${
                    active
                      ? "text-fg"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <l.Icon className="size-3.5" />
                  <span>{l.label}</span>
                  {/* 2px structural rule under the active link, anchored
                      to the header's bottom hairline. Replaces the prior
                      pill-fill which collided with hover state. */}
                  <span
                    aria-hidden
                    className={`absolute left-2 right-2 -bottom-px h-[2px] transition-opacity ${
                      active
                        ? "bg-fg opacity-100"
                        : "bg-fg opacity-0 group-hover/nav:opacity-30"
                    }`}
                  />
                </Link>
              );
            })}

            {/* MORE — overflow for low-traffic destinations */}
            {mounted && secondary.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  data-testid="nav-more"
                  data-active={moreActive ? "true" : undefined}
                  className={`group/nav relative inline-flex items-center gap-1.5 h-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg/40 ${
                    moreActive
                      ? "text-fg"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <MoreHorizontal className="size-3.5" />
                  <span>More</span>
                  <ChevronDown className="size-3 text-fg-faint" />
                  <span
                    aria-hidden
                    className={`absolute left-2 right-2 -bottom-px h-[2px] transition-opacity ${
                      moreActive
                        ? "bg-fg opacity-100"
                        : "bg-fg opacity-0 group-hover/nav:opacity-30"
                    }`}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <span className="mono-meta-sm text-fg-faint tracking-[0.14em]">
                      MORE
                    </span>
                  </DropdownMenuLabel>
                  {secondary.map((s) => (
                    <DropdownMenuItem
                      key={s.href}
                      render={<Link href={s.href} data-testid={s.testId} />}
                    >
                      <s.Icon className="size-3.5" />
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>

          {/* COMPACT (<lg) hamburger — left-slide drawer */}
          <div className="lg:hidden ml-auto">
            {mounted && wsForLinks && (
              <>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={drawerOpen}
                  data-testid="nav-mobile-trigger"
                  className="inline-flex items-center justify-center size-9 rounded-md text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 [@media(hover:none)_and_(pointer:coarse)]:min-h-11 [@media(hover:none)_and_(pointer:coarse)]:min-w-11"
                >
                  <Menu className="size-4" />
                </button>
                <MobileNavDrawer
                  open={drawerOpen}
                  onOpenChange={setDrawerOpen}
                  primary={primary}
                  secondary={secondary}
                  email={email}
                  isActive={isActive}
                />
              </>
            )}
          </div>

          {/* RIGHT — palette · bell · avatar */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => openCommandPalette()}
              data-testid="palette-trigger"
              aria-label="Open command palette"
              title="Search or jump (⌘K)"
              className="hidden md:inline-flex items-center gap-2 h-8 pl-2 pr-1.5 rounded-md border border-hairline bg-[color:var(--surface)] text-xs text-fg-faint hover:text-fg hover:border-hairline-hi transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40"
            >
              <Search className="size-3.5" aria-hidden />
              <span className="text-fg-muted">Search</span>
              <kbd className="ml-2 mono-meta-sm border border-hairline rounded px-1 py-0 leading-none tabular-nums">
                ⌘K
              </kbd>
            </button>
            {/* Compact icon-only trigger below md */}
            <button
              type="button"
              onClick={() => openCommandPalette()}
              aria-label="Open command palette"
              className="md:hidden inline-flex items-center justify-center size-9 rounded-md text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/40 [@media(hover:none)_and_(pointer:coarse)]:min-h-11 [@media(hover:none)_and_(pointer:coarse)]:min-w-11"
            >
              <Search className="size-4" />
            </button>
            {mounted && (
              <div className="hidden lg:inline-flex">
                <SidebarCollapseToggle />
              </div>
            )}
            {mounted && <NotificationBell userId={userId} />}
            {mounted && (
              <AccountMenu
                userId={userId}
                email={email}
                canImportPlan={canImportPlan}
              />
            )}
          </div>
        </div>
      </header>
    </>
  );
}
