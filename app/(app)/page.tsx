import { redirect } from "next/navigation";
import { Briefcase } from "lucide-react";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { EmptyState } from "@/components/empty-state";

export default async function Home() {
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);
  if (ws.length === 0) {
    return (
      <main className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
          <p className="text-sm text-muted-foreground">Get started by creating your first workspace.</p>
        </div>
        <EmptyState
          icon={<Briefcase />}
          title="No workspaces yet"
          description="Workspaces help you group boards by team or project. Use the workspace switcher in the top nav to create one."
        />
      </main>
    );
  }
  redirect(`/w/${ws[0].id}`);
}
