import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { TopNav } from "@/components/nav/top-nav";
import { TourOverlay } from "@/components/onboarding/tour-overlay";
import { ErrorPane } from "@/components/error-pane";
import { UndoBanner } from "@/components/undo-banner";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { QuickAddCardMount } from "@/components/quick-add-card-dialog";
import { CommandPalette } from "@/components/command-palette";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { listFavoriteBoards, listRecentBoardViews } from "@/lib/queries/favorites";
import { dbAsUser } from "@/lib/db/client";
import { profiles, boards, dashboards } from "@/lib/db/schema";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);

  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  let activeWorkspaceId: string | undefined;
  const wsMatch = path.match(/^\/w\/([0-9a-f-]{36})/);
  const boardMatch = path.match(/^\/b\/([0-9a-f-]{36})/);
  const dashboardMatch = path.match(/^\/dashboards\/([0-9a-f-]{36})/);
  if (wsMatch) {
    activeWorkspaceId = wsMatch[1];
  } else if (boardMatch) {
    // On board / card pages there's no workspace in the URL. Resolve via
    // the board's workspace_id so the top-nav links (Roadmap, Boards,
    // Backlog…) stay in the right workspace instead of falling back to
    // workspaces[0] which is usually Demo.
    try {
      const [row] = await dbAsUser(token, async (tx) =>
        tx
          .select({ workspaceId: boards.workspaceId })
          .from(boards)
          .where(eq(boards.id, boardMatch[1])),
      );
      activeWorkspaceId = row?.workspaceId;
    } catch {
      activeWorkspaceId = undefined;
    }
  } else if (dashboardMatch) {
    // On a workspace-scoped dashboard, resolve the workspace from the
    // dashboard row so the top-nav links route to that workspace
    // instead of falling back to workspaces[0]. Personal-scope
    // dashboards have a null workspaceId, in which case we leave
    // activeWorkspaceId undefined and the nav uses its own fallback.
    try {
      const [row] = await dbAsUser(token, async (tx) =>
        tx
          .select({ workspaceId: dashboards.workspaceId })
          .from(dashboards)
          .where(eq(dashboards.id, dashboardMatch[1])),
      );
      activeWorkspaceId = row?.workspaceId ?? undefined;
    } catch {
      activeWorkspaceId = undefined;
    }
  }

  // Plan #16b-γ-B (#7) — fetch the onboarding flag so we can decide
  // whether to render the first-run tour. On any error (RLS, transient DB
  // hiccup) default to "completed" so we never accidentally pin the
  // overlay to the user's screen forever.
  let onboardingCompletedAt: Date | null = new Date();
  try {
    const [row] = await dbAsUser(token, async (tx) =>
      tx
        .select({
          onboardingCompletedAt: profiles.onboardingCompletedAt,
        })
        .from(profiles)
        .where(eq(profiles.id, user.id)),
    );
    onboardingCompletedAt = row?.onboardingCompletedAt ?? null;
  } catch {
    // Leave default (non-null) so the tour stays hidden.
  }

  const showTour = onboardingCompletedAt === null && ws.length > 0;

  // Plan #16b-γ-C (#4 + #5) — favorites and recents are surfaced in the
  // top nav so the user can jump cross-workspace. Best-effort: any RLS
  // hiccup falls back to an empty list rather than blocking the whole
  // app shell.
  let favorites: Awaited<ReturnType<typeof listFavoriteBoards>> = [];
  let recents: Awaited<ReturnType<typeof listRecentBoardViews>> = [];
  try {
    favorites = await listFavoriteBoards(token);
  } catch {
    favorites = [];
  }
  try {
    recents = await listRecentBoardViews(token, 5);
  } catch {
    recents = [];
  }

  return (
    <>
      <TopNav
        email={user.email ?? ""}
        userId={user.id}
        workspaces={ws.map(w => ({ id: w.id, name: w.name }))}
        activeWorkspaceId={activeWorkspaceId}
        favorites={favorites}
        recents={recents}
      />
      <main id="main" className="min-h-[calc(100vh-3.5rem)]">{children}</main>
      {showTour && <TourOverlay />}
      <ErrorPane />
      <UndoBanner />
      <ShortcutsOverlay />
      <QuickAddCardMount hasWorkspaces={ws.length > 0} />
      <CommandPalette
        workspaces={ws.map((w) => ({ id: w.id, name: w.name }))}
        activeWorkspaceId={activeWorkspaceId}
        favorites={favorites.map((f) => ({
          boardId: f.boardId,
          boardTitle: f.boardTitle,
          workspaceId: f.workspaceId,
          workspaceName: f.workspaceName,
        }))}
        recents={recents.map((r) => ({
          boardId: r.boardId,
          boardTitle: r.boardTitle,
          workspaceId: r.workspaceId,
          workspaceName: r.workspaceName,
        }))}
      />
    </>
  );
}
