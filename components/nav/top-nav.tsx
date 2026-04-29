import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";
import { WorkspaceSwitcher, type WorkspaceLite } from "@/components/workspace/workspace-switcher";

export function TopNav({
  email, workspaces, activeWorkspaceId,
}: {
  email: string;
  workspaces: WorkspaceLite[];
  activeWorkspaceId?: string;
}) {
  return (
    <header className="border-b">
      <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/" className="font-semibold">Trello Clone</Link>
          <span className="text-muted-foreground">/</span>
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{email}</span>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">Log out</Button>
          </form>
        </div>
      </div>
    </header>
  );
}
