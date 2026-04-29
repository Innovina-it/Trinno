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
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 shadow-[0_1px_0_0_rgba(0,0,0,0.02)]">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/"
            className="font-semibold tracking-tight transition-opacity duration-150 hover:opacity-80"
          >
            Trello Clone
          </Link>
          <span className="text-muted-foreground/60">/</span>
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <SearchBox />
          <span className="hidden md:inline text-muted-foreground truncate max-w-[180px]">
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
