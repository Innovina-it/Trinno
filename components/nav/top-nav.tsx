import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";
import { WorkspaceSwitcher, type WorkspaceLite } from "@/components/workspace/workspace-switcher";
import { SearchBox } from "@/components/nav/search-box";
import { NotificationBell } from "@/components/nav/notification-bell";

export function TopNav({
  email, userId, workspaces, activeWorkspaceId,
}: {
  email: string;
  userId: string;
  workspaces: WorkspaceLite[];
  activeWorkspaceId?: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-[color:rgb(15_8_42/0.55)] backdrop-blur-2xl">
      {/* Soft violet wash inside the bar — adds atmospheric tint */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[color:rgb(139_92_246/0.06)] to-transparent" />
      <div className="relative max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo dot — animated gradient ring */}
          <span aria-hidden className="relative flex size-7 items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-cyan via-accent-magenta to-accent-violet opacity-90" />
            <span className="absolute inset-[3px] rounded-full bg-[color:var(--bg-deep)]" />
            <span className="relative size-1.5 rounded-full bg-gradient-to-br from-accent-cyan to-accent-magenta" />
          </span>
          <Link
            href="/"
            aria-label="Trello Clone"
            className="mono-meta tracking-[0.18em] text-fg transition-opacity hover:opacity-80"
          >
            TRINNOVIN<span className="gradient-text-static font-bold">A</span>
          </Link>
          <span className="text-fg-faint select-none" aria-hidden>/</span>
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
          {activeWorkspaceId && (
            <>
              <span className="text-fg-faint select-none" aria-hidden>/</span>
              <Link
                href={`/w/${activeWorkspaceId}/backlog`}
                className="mono-meta-sm tracking-[0.18em] text-fg-muted hover:text-fg transition-colors"
              >
                BACKLOG
              </Link>
              <span className="text-fg-faint select-none" aria-hidden>/</span>
              <Link
                href={`/w/${activeWorkspaceId}/roadmap`}
                className="mono-meta-sm tracking-[0.18em] text-fg-muted hover:text-fg transition-colors"
              >
                ROADMAP
              </Link>
              <span className="text-fg-faint select-none" aria-hidden>/</span>
              <Link
                href={`/w/${activeWorkspaceId}/versions`}
                className="mono-meta-sm tracking-[0.18em] text-fg-muted hover:text-fg transition-colors"
              >
                VERSIONS
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <SearchBox />
          <NotificationBell userId={userId} />
          <span className="hidden md:inline mono-meta-sm text-fg-faint truncate max-w-[160px]">
            {email}
          </span>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">Log out</Button>
          </form>
        </div>
      </div>
    </header>
  );
}
