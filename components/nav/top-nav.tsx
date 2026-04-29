import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";
import { WorkspaceSwitcher, type WorkspaceLite } from "@/components/workspace/workspace-switcher";
import { SearchBox } from "@/components/nav/search-box";

export function TopNav({
  email, workspaces, activeWorkspaceId,
}: {
  email: string;
  workspaces: WorkspaceLite[];
  activeWorkspaceId?: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink bg-paper">
      <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Wordmark — JetBrains Mono uppercase, tight tracking.
              The accessible name "Trello Clone" is preserved via aria-label
              for downstream tests; the visible mark is the Trinnovina brand. */}
          <Link
            href="/"
            aria-label="Trello Clone"
            className="mono-meta text-ink tracking-[0.18em] hover:text-signal transition-colors"
          >
            TRINNOVINA
          </Link>
          <span className="text-ink/30 select-none" aria-hidden>/</span>
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>
        <div className="flex items-center gap-3">
          <SearchBox />
          <span className="hidden md:inline mono-meta-sm text-ink/50 truncate max-w-[160px]">
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
