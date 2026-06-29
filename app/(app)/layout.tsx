import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { isImportPlanAllowed } from "@/lib/plan-import/access";
import { TopNav } from "@/components/nav/top-nav";
import { TourOverlay } from "@/components/onboarding/tour-overlay";
import { ErrorPane } from "@/components/error-pane";
import { SeedFailureBanner } from "@/components/seed-failure-banner";
import { UndoBanner } from "@/components/undo-banner";
import { UndoHotkeys } from "@/components/undo-hotkeys";
import { ShortcutsOverlay } from "@/components/shortcuts-overlay";
import { AccessNotice } from "@/components/access-notice";
import { CommandPalette } from "@/components/command-palette";
import { VersionWatcher } from "@/components/system/version-watcher";
import { getUserPreferences } from "@/actions/profile-preferences";
import { UserPreferencesProvider } from "@/lib/preferences/provider";
import { PreferencesBodyMirror } from "@/components/preferences-body-mirror";
import { listWorkspaces, getWorkspaceRole } from "@/lib/queries/workspaces";
import { listFavoriteBoards, listRecentBoardViews } from "@/lib/queries/favorites";
import { dbAsUser } from "@/lib/db/client";
import { profiles, boards, dashboards, links } from "@/lib/db/schema";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const token = (await getSessionToken())!;

  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  const wsMatch = path.match(/^\/w\/([0-9a-f-]{36})/);
  const boardMatch = path.match(/^\/b\/([0-9a-f-]{36})/);
  const dashboardMatch = path.match(/^\/dashboards\/([0-9a-f-]{36})/);

  // Plan #16b-γ-B (#7) — fetch the onboarding flag so we can decide
  // whether to render the first-run tour. On any error (RLS, transient DB
  // hiccup) default to "completed" so we never accidentally pin the
  // overlay to the user's screen forever.
  //
  // Perf (P1.6) — coalesce the route-scoped workspace lookup (board or
  // dashboard) and the onboarding-flag fetch into a single dbAsUser
  // transaction so they share one BEGIN/SET/COMMIT round-trip instead of
  // running serially. listWorkspaces / listFavoriteBoards /
  // listRecentBoardViews are kicked off in parallel via Promise.all
  // alongside this transaction — they each open their own dbAsUser
  // session, but at least they run concurrently rather than sequentially.
  type RouteWorkspace = { workspaceId: string | null } | undefined;
  type OnboardingRow = { onboardingCompletedAt: Date | null } | undefined;

  const layoutTx = dbAsUser(token, async (tx) => {
    const tasks: Array<Promise<unknown>> = [];

    let routePromise: Promise<RouteWorkspace> = Promise.resolve(undefined);
    if (boardMatch) {
      // On board / card pages there's no workspace in the URL. Resolve via
      // the board's workspace_id so the top-nav links (Roadmap, Boards,
      // Backlog…) stay in the right workspace instead of falling back to
      // workspaces[0] which is usually Demo.
      routePromise = tx
        .select({ workspaceId: boards.workspaceId })
        .from(boards)
        .where(eq(boards.id, boardMatch[1]))
        .then((rows) => rows[0] as RouteWorkspace)
        .catch(() => undefined);
      tasks.push(routePromise);
    } else if (dashboardMatch) {
      // On a workspace-scoped dashboard, resolve the workspace from the
      // dashboard row so the top-nav links route to that workspace
      // instead of falling back to workspaces[0]. Personal-scope
      // dashboards have a null workspaceId.
      routePromise = tx
        .select({ workspaceId: dashboards.workspaceId })
        .from(dashboards)
        .where(eq(dashboards.id, dashboardMatch[1]))
        .then((rows) => rows[0] as RouteWorkspace)
        .catch(() => undefined);
      tasks.push(routePromise);
    }

    const onboardingPromise: Promise<OnboardingRow> = tx
      .select({ onboardingCompletedAt: profiles.onboardingCompletedAt })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .then((rows) => rows[0] as OnboardingRow)
      .catch(() => undefined);
    tasks.push(onboardingPromise);

    await Promise.all(tasks);
    return {
      route: await routePromise,
      onboarding: await onboardingPromise,
    };
  });

  // Kick off the independent queries in parallel. Each opens its own
  // dbAsUser transaction (separate JWT bookkeeping), but the wall-clock
  // cost is now max() of the request set instead of sum().
  const [
    wsResult,
    layoutResult,
    favoritesResult,
    recentsResult,
    preferencesResult,
  ] =
    await Promise.allSettled([
      listWorkspaces(token),
      layoutTx,
      listFavoriteBoards(token),
      listRecentBoardViews(token, 5),
      getUserPreferences(),
    ]);

  let ws: Awaited<ReturnType<typeof listWorkspaces>> = [];
  let shellError: string | null = null;
  if (wsResult.status === "fulfilled") {
    ws = wsResult.value;
  } else {
    const err = wsResult.reason;
    shellError =
      err instanceof Error
        ? err.message
        : "Could not load your workspaces after sign-in.";
  }

  let activeWorkspaceId: string | undefined;
  if (wsMatch) {
    activeWorkspaceId = wsMatch[1];
  } else if (layoutResult.status === "fulfilled") {
    activeWorkspaceId = layoutResult.value.route?.workspaceId ?? undefined;
  }

  // Default to a non-null timestamp so any failure path keeps the tour
  // hidden — matches the pre-P1.6 behavior.
  const onboardingCompletedAt: Date | null =
    layoutResult.status === "fulfilled"
      ? (layoutResult.value.onboarding?.onboardingCompletedAt ?? null)
      : new Date();

  const showTour = onboardingCompletedAt === null && ws.length > 0;

  if (shellError) {
    return (
      <main className="min-h-dvh bg-[color:var(--bg-deep)] px-6 py-16 text-fg">
        <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-hairline bg-[color:var(--surface)] p-6">
          <p className="mono-meta-sm text-fg-faint">SIGNED IN</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            The app could not reach the workspace database.
          </h1>
          <p className="text-sm leading-relaxed text-fg-muted">
            Your login worked, but the workspace query failed while loading the
            app shell. Refresh once after the database frees a connection.
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg border border-hairline bg-black/30 p-3 text-xs text-fg-muted">
            {shellError}
          </pre>
        </div>
      </main>
    );
  }

  // Plan #16b-γ-C (#4 + #5) — favorites and recents are surfaced in the
  // top nav so the user can jump cross-workspace. Best-effort: any RLS
  // hiccup falls back to an empty list rather than blocking the whole
  // app shell.
  const favorites: Awaited<ReturnType<typeof listFavoriteBoards>> =
    favoritesResult.status === "fulfilled" ? favoritesResult.value : [];
  const recents: Awaited<ReturnType<typeof listRecentBoardViews>> =
    recentsResult.status === "fulfilled" ? recentsResult.value : [];
  const initialPreferences =
    preferencesResult.status === "fulfilled" ? preferencesResult.value : {};

  // Task 16 — the active workspace's optional shared-folder link plus the
  // viewer's role, so the switcher can render a cloud icon (all members can
  // open; only owner/admin can edit). Best-effort: any RLS/transient failure
  // falls back to "no link / cannot edit" and simply hides the icon.
  let activeWorkspaceLink: { url: string } | null = null;
  let canEditWorkspaceLink = false;
  if (activeWorkspaceId) {
    const wsId = activeWorkspaceId;
    const [linkRes, roleRes] = await Promise.allSettled([
      dbAsUser(token, async (tx) => {
        const [row] = await tx
          .select({ url: links.url })
          .from(links)
          .where(and(eq(links.workspaceId, wsId), eq(links.scope, "workspace")))
          .limit(1);
        return row ?? null;
      }),
      getWorkspaceRole(token, wsId, user.id),
    ]);
    if (linkRes.status === "fulfilled" && linkRes.value) {
      activeWorkspaceLink = { url: linkRes.value.url };
    }
    if (roleRes.status === "fulfilled") {
      canEditWorkspaceLink =
        roleRes.value === "owner" || roleRes.value === "admin";
    }
  }

  return (
    <UserPreferencesProvider initial={initialPreferences}>
      <PreferencesBodyMirror />
      <TopNav
        email={user.email ?? ""}
        userId={user.id}
        workspaces={ws.map(w => ({ id: w.id, name: w.name }))}
        activeWorkspaceId={activeWorkspaceId}
        activeWorkspaceLink={activeWorkspaceLink}
        canEditWorkspaceLink={canEditWorkspaceLink}
        canImportPlan={isImportPlanAllowed(user.email)}
      />
      <main id="main" className="min-h-[calc(100dvh-3.5rem)]">{children}</main>
      {showTour && <TourOverlay />}
      <ErrorPane />
      <SeedFailureBanner />
      <UndoBanner />
      <UndoHotkeys />
      <ShortcutsOverlay />
      <AccessNotice />
      <VersionWatcher />
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
    </UserPreferencesProvider>
  );
}
