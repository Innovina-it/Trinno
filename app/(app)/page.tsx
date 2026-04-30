import { redirect } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);
  if (ws.length === 0) {
    return (
      <main className="space-y-12 py-8">
        <header className="space-y-3">
          <span className="chip">No. 00 — Onboarding</span>
          <h1 className="serif-display text-7xl">
            <span className="text-fg/90">Welcome</span>
            <span className="gradient-text">.</span>
          </h1>
          <p className="text-fg-muted text-lg max-w-md">
            Get started by creating your first studio workspace.
          </p>
        </header>

        <div className="glass-strong noise-overlay rounded-3xl px-8 py-24 text-center">
          <p className="serif-display text-5xl md:text-6xl gradient-text italic">
            &ldquo;Nothing in your studio yet.&rdquo;
          </p>
          <p className="mono-meta mt-8 text-fg-muted max-w-md mx-auto">
            Workspaces group boards by team or project. Use the switcher in the
            top strip to draft your first one.
          </p>
        </div>
      </main>
    );
  }
  redirect(`/w/${ws[0].id}`);
}
