import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);
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
  redirect(`/w/${ws[0].id}`);
}
