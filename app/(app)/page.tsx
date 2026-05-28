import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { getUserPreferences } from "@/actions/profile-preferences";
import { type Preferences } from "@/lib/preferences/types";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  let ws: Awaited<ReturnType<typeof listWorkspaces>> = [];
  let loadError: string | null = null;
  try {
    ws = await listWorkspaces(token);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Could not load workspaces.";
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-6 py-12">
        <span className="mono-meta-sm text-fg-faint">SIGNED IN</span>
        <h1 className="font-sans text-3xl font-bold tracking-tight text-fg">
          Database is busy
        </h1>
        <p className="text-sm text-fg-muted max-w-md">
          Login succeeded, but the workspace list could not load. Refresh once
          after the database frees a connection.
        </p>
        <pre className="max-h-48 overflow-auto rounded-xl border border-hairline bg-[color:var(--surface)] p-3 text-xs text-fg-muted">
          {loadError}
        </pre>
      </div>
    );
  }
  if (ws.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-12">
        <header className="space-y-2">
          <span className="mono-meta-sm text-fg-faint">ONBOARDING</span>
          <h1 className="font-sans text-3xl font-bold tracking-tight text-fg">
            Welcome
          </h1>
          <p className="text-sm text-fg-muted max-w-md">
            Create a workspace to start. It groups boards by team or project.
          </p>
        </header>

        <div className="rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-12 text-center space-y-2">
          <p className="mono-meta-sm text-fg-faint">NO WORKSPACES</p>
          <p className="text-sm text-fg-muted">
            Use the switcher in the top strip to create your first one.
          </p>
        </div>
      </div>
    );
  }
  // Prefer the last-visited workspace if the user still has access to it.
  // Falls back to the first workspace on stale ids (deleted workspace,
  // revoked membership) or when preferences fail to load.
  const preferences: Preferences = await getUserPreferences().catch(() => ({}));
  const lastWorkspaceId = preferences.lastWorkspaceId;
  const target =
    lastWorkspaceId && ws.some((w) => w.id === lastWorkspaceId)
      ? lastWorkspaceId
      : ws[0].id;
  redirect(`/w/${target}`);
}
