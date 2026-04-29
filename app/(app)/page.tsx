import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);
  if (ws.length === 0) {
    return (
      <main className="space-y-10 py-6">
        <header className="space-y-2">
          <span className="mono-meta text-ink/50">No. 00 — Onboarding</span>
          <h1 className="serif-display text-6xl text-ink">Welcome.</h1>
          <p className="mono-meta-sm text-ink/60 mt-3">
            Get started by creating your first workspace.
          </p>
        </header>

        {/* Editorial pull-quote empty state */}
        <div className="border border-rule paper-grid px-8 py-20 text-center">
          <p className="serif-display text-5xl text-ink/80 italic">
            &ldquo;No workspaces yet.&rdquo;
          </p>
          <p className="mono-meta mt-6 text-ink/50 max-w-md mx-auto">
            Workspaces group boards by team or project. Use the switcher in the
            top strip to draft one.
          </p>
        </div>
      </main>
    );
  }
  redirect(`/w/${ws[0].id}`);
}
